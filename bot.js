const TelegramBot = require('node-telegram-bot-api');
const voiceHandler = require('./voiceHandler');
const UserTG = require('./models/UserTG');

const token = process.env.TELEGRAM_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });

const start = () => {
    // Обработка голосовых сообщений
    bot.on('voice', (msg) => {
        voiceHandler.handleVoiceMessage(bot, msg);
    });

    // Ответ на команду /start
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username;
        console.log(chatId);
        
    
        // Находим пользователя в базе данных
        let user = await UserTG.findOne({ username });
        
        if (!user) {
            // Если пользователя нет, создаем нового с chatId
            user = new UserTG({ username, chatId, plans: [] });
            await user.save();
            console.log(`Новый пользователь зарегистрирован: ${username}`);
        } else {
            // Обновляем chatId, если он не сохранен
            if (!user.chatId) {
                user.chatId = chatId;
                await user.save();
                console.log(`ChatId для пользователя ${username} обновлен`);
            }
        }
    
        bot.sendMessage(chatId, 'Добро пожаловать! Я помогу тебе с планированием дня.');
    });
};

module.exports = { start };