const mongoose = require('mongoose');

// Подключение к базе данных
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            // Remove CA certificate requirement
            ssl: true,
            tls: true,
            dbName: 'test'
        });
        
        console.log(`База данных подключена: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Ошибка подключения к базе данных: ${error.message}`);
        // Instead of exiting, we can retry the connection
        setTimeout(connectDB, 5000);
    }
};

// Add connection event handlers
mongoose.connection.on('disconnected', () => {
    console.log('MongoDB отключена. Попытка переподключения...');
    setTimeout(connectDB, 5000);
});

mongoose.connection.on('error', (err) => {
    console.error('Ошибка MongoDB:', err);
});

module.exports = connectDB;