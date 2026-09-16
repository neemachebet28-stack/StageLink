// ==================================================
// StageLink — organization profile (operator-editable)
// ==================================================
// verification_status is deliberately NOT editable here — it's an
// admin-only field (see database.sql on organizations) and an
// operator claiming their own verification would defeat its entire
// purpose. Everything in this file is scoped to a single
// organization_id, passed explicitly by the caller from
// req.currentUser.organizationId — never trusted from a route param.
const { pool } = require('../config/db');

async function getOrganization(organizationId) {
  const [rows] = await pool.query('SELECT * FROM organizations WHERE id = ?', [organizationId]);
  return rows[0] || null;
}

async function updateOrganizationProfile(organizationId, { name, description, contactEmail, contactPhone, logoUrl }) {
  await pool.query(
    `UPDATE organizations
     SET name = ?, description = ?, contact_email = ?, contact_phone = ?, logo_url = ?
     WHERE id = ?`,
    [name, description || null, contactEmail || null, contactPhone || null, logoUrl || null, organizationId]
  );
}

module.exports = { getOrganization, updateOrganizationProfile };
