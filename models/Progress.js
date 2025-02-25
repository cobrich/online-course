const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    questionsAsked: {
        type: Number,
        default: 0,
    },
    correctAnswers: {
        type: Number,
        default: 0,
    },
    lastActivity: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Progress', progressSchema);