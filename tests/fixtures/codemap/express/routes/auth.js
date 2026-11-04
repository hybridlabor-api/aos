const express = require('express');
const router = express.Router();

router.get('/details', (req, res) => res.json({}));
router.post('/create', (req, res) => res.json({}));

module.exports = router;
