/* /api/me — session info + school onboarding.
   GET  -> { user, school: { id, name, role } | null }
   POST -> onboarding: create a school, make the caller its owner, and copy the
           Stonehill route/stop templates into it. */
const { db, ok, fail, preflight, readBody, requireUser, membership } = require('./_shared');

const TEMPLATE_SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const user = await requireUser(event);
  if (!user) return fail(401, 'Unauthorized');

  const client = db();

  if (event.httpMethod === 'GET') {
    const mem = await membership(client, user.userId);
    return ok({
      user: { userId: user.userId, email: user.email || null },
      school: mem ? { id: mem.schoolId, name: mem.schoolName, role: mem.role } : null
    });
  }

  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const existing = await membership(client, user.userId);
  if (existing) {
    return fail(409, 'Account already belongs to a school');
  }

  const body = readBody(event);
  if (!body) return fail(400, 'Invalid JSON body');

  const name = String(body.name || '').trim();
  if (!name) return fail(400, 'name is required');
  if (name.length > 120) return fail(400, 'name must be 120 characters or fewer');

  const created = await client.query(
    'INSERT INTO schools (name) VALUES ($1) RETURNING id, name',
    [name]
  );
  const school = created.rows[0];

  await client.query(
    'INSERT INTO school_members (school_id, user_id, role) VALUES ($1, $2, $3)',
    [school.id, user.userId, 'owner']
  );

  // Copy the template routes/stops into the new school so the dashboard works.
  await client.query(
    `INSERT INTO routes (school_id, code, name, color)
       SELECT $1, code, name, color FROM routes WHERE school_id = $2`,
    [school.id, TEMPLATE_SCHOOL_ID]
  );
  await client.query(
    `INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
       SELECT nr.id, s.seq, s.name, s.lat, s.lng, s.traffic
         FROM routes nr
         JOIN routes tr ON tr.code = nr.code AND tr.school_id = $2
         JOIN stops s ON s.route_id = tr.id
        WHERE nr.school_id = $1`,
    [school.id, TEMPLATE_SCHOOL_ID]
  );

  return ok({ school: { id: school.id, name: school.name, role: 'owner' } });
};
