const express = require('express');
const app = express();
import settingsRouter from './routes/settings.js';

app.get('/api/health', (req, res) => res.send('OK'));
app.post('/api/users', (req, res) => res.json({}));
app.put('/api/users/:id', (req, res) => res.json({}));

const router = express.Router();
router.get('/info', (req, res) => res.json({}));
app.use('/api/v2', router);

app.get('/api/file.name(with*special)', (req, res) => res.json({}));

app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/settings', settingsRouter);
