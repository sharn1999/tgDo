const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
    task: String,
    time: String
});

const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    chatId: {type: Number, required: true},
    plans: [planSchema],
    createdAt: { type: Date, default: Date.now }
});

const UserTG = mongoose.model('UserTG', userSchema);

module.exports = UserTG;