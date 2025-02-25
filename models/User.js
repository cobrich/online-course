const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Import JWT_SECRET from server
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-2024';

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    tokens: [{
        token: {
            type: String,
            required: true
        }
    }]
});

// Метод для генерации токена
userSchema.methods.generateAuthToken = async function () {
    const user = this;
    const token = jwt.sign({ _id: user._id.toString() }, JWT_SECRET);
    user.tokens = user.tokens.concat({ token });
    await user.save();
    return token;
};

module.exports = mongoose.model('User', userSchema);