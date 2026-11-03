const express = require('express');
const app = express();

app.get('/api/health', (req, res) => res.send('OK'));
app.post('/api/users', (req, res) => res.json({}));
app.put('/api/users/:id', (req, res) => res.json({}));

const router = express.Router();
router.get('/info', (req, res) => res.json({}));
app.use('/api/v2', router);
