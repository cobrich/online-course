const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: ['video', 'image', 'text'],
        required: true,
    },
    url: {
        type: String,
        required: true,
    },
});

module.exports = mongoose.model('Material', materialSchema);