require('dotenv').config();
const bot = require('./bot');

const port = process.env.PORT || 3000;
app.listen(port, () => {
    bot.start();
    console.log(`App is running on port ${port}`);
});

// Запуск бота
