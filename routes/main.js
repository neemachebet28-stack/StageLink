// ==================================================
// StageLink — top-level marketing/landing routes
// ==================================================
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    title: 'Home',
  });
});

module.exports = router;
