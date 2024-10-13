const OpenAI = require('openai');
require('dotenv').config();
const cron = require('node-cron');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const UserTG = require('./models/UserTG');

const openai = new OpenAI({
    apiKey: process.env.OPENAI
});

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Error connecting to MongoDB:', err));

const scheduledTasks = {};

async function generatePlan(newTaskText, username, bot) {
    let user = await UserTG.findOne({ username });

    if (!user) {
        // Если пользователя нет, регистрируем его
        user = new UserTG({ username, plans: [] });
        await user.save();
        console.log(`Новый пользователь зарегистрирован: ${username}`);
    } else {
        console.log(`Пользователь ${username} уже существует в базе данных`);
    }

    // Формируем текст для OpenAI, комбинируя старые задачи с новыми
    const existingTasksText = user.plans.map(task => `${task.time}: ${task.task}`).join('\n');
    const combinedTasksText = `${existingTasksText}\n${newTaskText}`;
    
    // Генерируем новый план через OpenAI, передавая все задачи
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            "role": "system",
            "content": `
Ты — помощник, который помогает людям организовать их расписание. Твоя задача — принимать список дел и помогать пользователю составить полный план с указанием времени выполнения. Если пользователь указал конкретное время или дату для задачи, используй эти данные. Если время или дата не указаны, предложи логичный и удобный временной интервал для выполнения задачи, исходя из стандартного распорядка дня. Не используй символы форматирования, такие как ** или ##. Добавь мотивирующую фразу в начале и в конце расписания, чтобы подбодрить пользователя. Не придумывай от себя дополнительные занятия. НЕ ВЫДУМЫВАЙ НОВЫЕ ЗАДАНИЯ КОТОРЫЕ ПОЛЬЗОВАТЕЛЬ НЕ УПОМИНАЛ. Если начинается с одиночной цифры, записывай ее в формате не 7:00, а 07:00

Пример как должно выглядеть сообщение:

Начнем продуктивный день!

Вот как можно распланировать твое время для занятий уроками сегодня:

08:00 - 10:00: Проснуться

10:00 - 11:30: Первая сессия занятий  
  Начни с самых сложных или важных материалов, пока твоя концентрация на максимуме.  

11:30 - 12:00: Перерыв  
  Используй это время, чтобы отдохнуть, размяться или перекусить.  

12:00 - 13:30: Вторая сессия занятий  
  Продолжай работу, сосредоточившись на оставшихся темах или заданиях.

Ты отлично справишься, вперед к новым знаниям!
            `
          },
          {
            "role": "user",
            "content": combinedTasksText
          }
        ]
    });

    const planText = response.choices[0].message.content;

    // Извлекаем новые задачи из текста
    const tasks = extractTasksFromPlan(planText);
    
    try {

        console.log(tasks);
        
        // Заменяем старые задачи на новый план
        user.plans = tasks;

        // Сохраняем обновленного пользователя с новым планом
        await user.save();    
        console.log('Новый план успешно сохранен в базе данных');

        if (scheduledTasks[username]) {
            scheduledTasks[username].forEach(task => task.stop());
            console.log(`Удалены старые задачи для пользователя ${username}`);
        }

        scheduledTasks[username] = tasks.map(task => scheduleTask(task, username, bot));    

        // Возвращаем пользователю новый план
        return planText;

    } catch (error) {
        console.error('Ошибка при сохранении плана:', error);
        return 'Ошибка при сохранении плана.';
    }
}

function extractTasksFromPlan(planText) {
    console.log('Исходный текст плана:', planText);

    // Разбиваем текст на строки
    const lines = planText.split('\n').filter(line => line.trim() !== '');

    console.log('Найденные строки:', lines);

    const tasks = [];
    lines.forEach((line) => {
        // Регулярное выражение для поиска времени в формате 'HH:MM - HH:MM' или 'HH:MM - Задача'
        const timeMatch = line.match(/\d{2}:\d{2}\s*(-\s*\d{2}:\d{2})?/);

        if (timeMatch) {
            // Извлекаем временной диапазон и задачу
            const timeRange = timeMatch[0].trim();
            const task = line.replace(timeRange, '').replace(':', '').trim(); // Убираем время и оставляем только задачу
            
            // Проверка на случай, если время - это просто одно время (без диапазона)
            tasks.push({ task, time: timeRange });
        }
    });

    return tasks;
}

function scheduleTask(task, username, bot) {
    // Получаем начало временного диапазона задачи
    const [startTime] = task.time.split('-').map(t => t.trim());

    // Извлекаем часы и минуты
    const [hours, minutes] = startTime.split(':');

    console.log(`Планируем задачу на ${hours}:${minutes} для пользователя ${username}`);

    // Проверка корректности часов и минут
    if (!hours || !minutes || isNaN(hours) || isNaN(minutes)) {
        console.error(`Ошибка в формате времени: ${startTime}`);
        return;
    }

    // Конвертируем время пользователя в локальное время сервера (Орегон)
    const userTime = moment.tz(`${hours}:${minutes}`, 'HH:mm', 'Asia/Almaty'); // Время пользователя (Казахстан)
    const serverTime = userTime.clone().tz('America/Los_Angeles'); // Перевод в серверное время (Орегон)

    const serverHours = serverTime.format('HH');
    const serverMinutes = serverTime.format('mm');

    // Логируем временные метки для отладки
    console.log(`Время пользователя (Казахстан): ${userTime.format('HH:mm')}`);
    console.log(`Конвертированное серверное время (Орегон): ${serverTime.format('HH:mm')}`);

    // Создаем задачу с помощью cron с учетом часового пояса сервера
    const cronTime = `${serverMinutes} ${serverHours} * * *`; // Ежедневно в определенное время на сервере

    const scheduledTask = cron.schedule(cronTime, async () => {
        console.log(`Напоминание для пользователя ${username}: Пора выполнить задачу "${task.task}"`);

        // Находим пользователя и отправляем ему сообщение
        const user = await UserTG.findOne({ username });
        if (user && user.chatId) {  // Проверяем, что у пользователя есть chatId
            try {
                await bot.sendMessage(user.chatId, `Напоминание: "${task.task}"`);
                console.log(`Сообщение отправлено пользователю ${username}`);
            } catch (err) {
                console.error(`Ошибка при отправке сообщения пользователю ${username}:`, err);
            }
        } else {
            console.log(`Не удалось найти chatId для пользователя ${username}`);
        }
    });

    console.log(`Задача "${task.task}" запланирована на серверное время ${serverHours}:${serverMinutes}`);

    return scheduledTask;
}

module.exports = { generatePlan };
