const mongoose = require('mongoose');

const qaHistorySchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    question: {
        type: String,
        required: true
    },
    answer: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('QAHistory', qaHistorySchema); 