require('dotenv').config();

const express = require('express');
const app = express();
const port = 3000;
const connectDB = require('./db');
const User = require('./models/User');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Progress = require('./models/Progress');
const Material = require('./models/Material');
const Message = require('./models/Messages');
const QAHistory = require('./models/QAHistory');
const { generatePrompt } = require('./prompts/educational');

const http = require('http');
const socketIo = require('socket.io');

// Создание HTTP-сервера
const server = http.createServer(app);

// Инициализация Socket.IO
const io = socketIo(server);

// Middleware для обработки JSON
app.use(express.json());
app.use(express.static('public'));

// Подключение к базе данных
connectDB();

// Near the top of your server.js file
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-2024';
console.log('JWT_SECRET:', JWT_SECRET);

// Socket.IO middleware for authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded._id;
        next();
    } catch (err) {
        next(new Error('Authentication error'));
    }
});

// Socket.IO connection handling
io.on('connection', async (socket) => {
    console.log('User connected:', socket.userId);

    try {
        // Send message history from database
        const messageHistory = await Message.find().sort({ timestamp: 1 });
        socket.emit('messageHistory', messageHistory);
    } catch (error) {
        console.error('Error fetching message history:', error);
    }

    // Handle new messages
    socket.on('sendMessage', async (messageData) => {
        try {
            // Create new message in database
            const message = new Message({
                text: messageData.text,
                userId: socket.userId,
                sender: messageData.sender,
                timestamp: new Date()
            });
            
            await message.save();
            
            // Broadcast the message to all connected clients
            io.emit('newMessage', message);
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.userId);
    });
});

// Обновление прогресса
const updateProgress = async (userId) => {
    let progress = await Progress.findOne({ userId });

    if (!progress) {
        progress = new Progress({ userId });
    }

    progress.questionsAsked += 1;
    progress.lastActivity = Date.now();
    await progress.save();
};

// Роут для главной страницы
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Роут для страницы регистрации
app.get('/register', (req, res) => {
    res.sendFile(__dirname + '/register.html');
});

// Роут для регистрации
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Проверка, существует ли пользователь с таким email
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
        }

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 8);

        // Создание нового пользователя
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: 'Пользователь успешно зарегистрирован' });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка при регистрации' });
    }
});

// Роут для страницы входа
app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

// Роут для входа
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        console.log('Login attempt for email:', email);
        
        // Поиск пользователя по email
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found');
            return res.status(400).json({ message: 'Неверный email или пароль' });
        }

        // Проверка пароля
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Password match:', isMatch);
        
        if (!isMatch) {
            return res.status(400).json({ message: 'Неверный email или пароль' });
        }

        // Генерация токена
        const token = await user.generateAuthToken();
        console.log('Token generated successfully');
        
        res.json({ message: 'Вход выполнен успешно', token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Ошибка при входе' });
    }
});

// GET route for ask page
app.get('/ask', (req, res) => {
    // Check for token in headers
    const authHeader = req.headers.authorization;
    console.log('Auth header:', authHeader); // Debug log
    
    try {
        res.sendFile(__dirname + '/ask.html');
    } catch (error) {
        console.error('Error serving ask.html:', error);
        res.status(500).send('Internal Server Error');
    }
});

// POST route for ask
app.post('/ask', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        console.log('Auth header:', authHeader);
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No valid auth header');
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const token = authHeader.replace('Bearer ', '');
        console.log('Extracted token:', token);
        
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('Decoded token:', decoded);
        const userId = decoded._id;

        if (!userId) {
            console.log('No userId in token');
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const { question } = req.body;

        // Language detection function
        function detectLanguage(text) {
            const cyrillicPattern = /[а-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ]/;
            if (cyrillicPattern.test(text)) {
                const kazakhPattern = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/;
                return kazakhPattern.test(text) ? 'kk' : 'ru';
            }
            return 'en';
        }

        const language = detectLanguage(question);

        // Search educational sources based on language
        async function searchEducationalSources(query, lang) {
            try {
                // Search Khan Academy
                const khanAcademyResponse = await axios.get(
                    `https://www.khanacademy.org/api/v1/search?lang=${lang}&query=${encodeURIComponent(query)}`
                );
        
                // Search Wikipedia
                const wikiLang = lang === 'kk' ? 'kk' : (lang === 'ru' ? 'ru' : 'en');
                const wikipediaResponse = await axios.get(
                    `https://${wikiLang}.wikipedia.org/w/api.php`, {
                    params: {
                        action: 'query',
                        format: 'json',
                        list: 'search',
                        srsearch: query,
                        utf8: 1
                    }
                });
        
                // Search images from Unsplash
                const unsplashResponse = await axios.get(
                    `https://api.unsplash.com/search/photos`, {
                    params: {
                        query: query,
                        client_id: process.env.UNSPLASH_API_KEY
                    }
                });
        
                // Search videos from YouTube
                const youtubeResponse = await axios.get(
                    `https://www.googleapis.com/youtube/v3/search`, {
                    params: {
                        part: 'snippet',
                        q: query,
                        type: 'video',
                        key: process.env.YOUTUBE_API_KEY
                    }
                });
        
                return {
                    khanAcademy: khanAcademyResponse.data,
                    wikipedia: wikipediaResponse.data,
                    images: unsplashResponse.data.results,
                    videos: youtubeResponse.data.items
                };
            } catch (error) {
                console.error('Error searching educational sources:', error);
                return null;
            }
        }

        // Get educational content
        const searchResults = await searchEducationalSources(question, language);

        // Get previous Q&A history
        const previousQA = await QAHistory.find({ userId })
            .sort({ timestamp: -1 })
            .limit(5)
            .select('question answer -_id');

        // Create enhanced prompt with educational sources
        const prompt = generatePrompt(language, question, previousQA, searchResults);

        // Get AI response with verified information
        const aiResponse = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyCIUeGFfJvgakyQJmGuaqevq8q2fKtwoz8',
            {
                contents: [
                    {
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
            }
        );

        const answer = aiResponse.data.candidates[0].content.parts[0].text;

        // Store Q&A in history
        await new QAHistory({
            userId,
            question,
            answer,
            sources: searchResults // Store sources for reference
        }).save();

        const answerWithMedia = async (answer, searchResults) => {
            try {
                // Check if searchResults and its properties exist
                const images = searchResults?.images || [];
                const videos = searchResults?.videos || [];

                return `
                    ${answer}
                    
                    ${images.length > 0 ? `
                        📸 **Изображения для наглядности:**
                        ${images.slice(0, 3).map(img => `- ![${img.alt_description || 'image'}](${img.urls.small})`).join('\n')}
                    ` : ''}
                    
                    ${videos.length > 0 ? `
                        🎥 **Видео для лучшего понимания:**
                        ${videos.slice(0, 3).map(video => `- [${video.snippet.title}](https://www.youtube.com/watch?v=${video.id.videoId})`).join('\n')}
                    ` : ''}
                `;
            } catch (error) {
                console.error('Error formatting media:', error);
                return answer; // Return just the answer if media formatting fails
            }
        };

        const formattedAnswer = await answerWithMedia(answer, searchResults);
        await updateProgress(userId);
        
        res.json({ 
            answer: formattedAnswer,
            sources: searchResults // Optional: Send sources to client
        });
    } catch (error) {
        console.error('Error in /ask:', error);
        res.status(500).json({ message: 'Ошибка при получении ответа от AI' });
    }
});

// Get Q&A history
app.get('/qa-history', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const history = await QAHistory.find({ userId: decoded._id })
            .sort({ timestamp: -1 });
        
        res.json(history);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ message: 'Ошибка при получении истории' });
    }
});

// Clear Q&A history
app.post('/clear-history', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        
        await QAHistory.deleteMany({ userId: decoded._id });
        
        res.json({ message: 'История очищена' });
    } catch (error) {
        console.error('Error clearing history:', error);
        res.status(500).json({ message: 'Ошибка при очистке истории' });
    }
});

// Роут для загрузки материалов
// Роут для добавления материалов
app.post('/upload-material', async (req, res) => {
    const { title, description, type, url } = req.body;

    try {
        const newMaterial = new Material({ title, description, type, url });
        await newMaterial.save();
        res.status(201).json({ message: 'Материал успешно загружен' });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка при загрузке материала' });
    }
});

// Роут для удаления материалов
app.delete('/delete-material/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await Material.findByIdAndDelete(id);
        res.json({ message: 'Материал удален' });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка при удалении материала' });
    }
});

// Роут для выхода
app.post('/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const token = authHeader.replace('Bearer ', '');
        
        // Find user and remove the current token
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded._id);
        
        if (user) {
            user.tokens = user.tokens.filter((t) => t.token !== token);
            await user.save();
        }

        res.json({ message: 'Выход выполнен успешно' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Ошибка при выходе из системы' });
    }
});

// Роут для получения профиля
app.get('/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Необходимо войти в систему' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Fetch user data
        const user = await User.findById(decoded._id).select('-password -tokens');
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        // Fetch user progress
        const progress = await Progress.findOne({ userId: decoded._id }) || {
            questionsAsked: 0,
            lastActivity: new Date()
        };

        res.json({ user, progress });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});

// GET route for profile page
app.get('/profile-page', (req, res) => {
    res.sendFile(__dirname + '/profile.html');
});

// Add chat route
app.get('/chat', (req, res) => {
    res.sendFile(__dirname + '/chat.html');
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});