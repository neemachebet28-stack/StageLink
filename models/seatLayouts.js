// ==================================================
// StageLink — vehicle seat layouts (operator-owned)
// ==================================================
const { pool } = require('../config/db');

async function listLayoutsForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT vsl.*, COUNT(v.id) AS vehicle_count
     FROM vehicle_seat_layouts vsl
     LEFT JOIN vehicles v ON v.seat_layout_id = vsl.id
     WHERE vsl.organization_id = ?
     GROUP BY vsl.id
     ORDER BY vsl.name ASC`,
    [organizationId]
  );
  return rows;
}

async function getLayoutForOrganization(layoutId, organizationId) {
  const [rows] = await pool.query(
    `SELECT * FROM vehicle_seat_layouts WHERE id = ? AND organization_id = ?`,
    [layoutId, organizationId]
  );
  return rows[0] || null;
}

/**
 * Creates a layout and auto-generates its seat positions in rows of
 * up to 4 (window, middle, middle, window) — a simple, real layout
 * rather than a full drag-and-drop seat-map editor, which is out of
 * scope here. total_seats always matches the actual generated row
 * count, never a number that isn't backed by real seat rows.
 */
async function createLayoutWithSeats(organizationId, name, totalSeats) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO vehicle_seat_layouts (organization_id, name, total_seats) VALUES (?, ?, ?)`,
      [organizationId, name, totalSeats]
    );
    const layoutId = result.insertId;

    const seatTypeForColumn = ['window', 'middle', 'middle', 'window'];
    let seatNumber = 1;
    let row = 1;
    while (seatNumber <= totalSeats) {
      const seatsInThisRow = Math.min(4, totalSeats - seatNumber + 1);
      for (let col = 0; col < seatsInThisRow; col += 1) {
        await connection.query(
          `INSERT INTO seat_layout_seats (seat_layout_id, seat_number, seat_row, seat_type) VALUES (?, ?, ?, ?)`,
          [layoutId, String(seatNumber), row, seatTypeForColumn[col]]
        );
        seatNumber += 1;
      }
      row += 1;
    }

    await connection.commit();
    return layoutId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { listLayoutsForOrganization, getLayoutForOrganization, createLayoutWithSeats };
