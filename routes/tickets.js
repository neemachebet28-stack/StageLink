// ==================================================
// StageLink — passenger ticket routes
// ==================================================
const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const ticketsModel = require('../models/tickets');

// --------------------------------------------------
// GET /bookings/:reference/ticket — mobile/print ticket view
// --------------------------------------------------
router.get(
  '/bookings/:reference/ticket',
  asyncRoute(async (req, res) => {
    const reference = req.params.reference;
    const tickets = await ticketsModel.getTicketsByReference(reference, req.sessionID);

    if (tickets.length === 0) {
      return res.status(404).render('errors/404', { title: 'Ticket not found' });
    }

    // QR image generated server-side from each ticket's opaque token —
    // never from anything client-supplied.
    const ticketsWithQr = await Promise.all(
      tickets.map(async (ticket) => ({
        ...ticket,
        qrDataUrl: await QRCode.toDataURL(ticket.qr_code_token, { margin: 1, width: 220 }),
      }))
    );

    res.render('passenger/tickets', {
      title: 'Your ticket',
      reference,
      tickets: ticketsWithQr,
    });
  })
);

module.exports = router;
