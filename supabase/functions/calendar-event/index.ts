/**
 * calendar-event Edge Function
 *
 * Generates .ics calendar files from query parameters.
 * Used in email templates for "Add to Calendar" links.
 * No auth required — params don't contain sensitive data.
 */

/**
 * Format a Date to iCalendar DTSTART/DTEND format (UTC)
 */
function formatIcsDate(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Escape text for iCalendar format
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generate a deterministic UID from the event params
 */
function generateUid(title: string, start: string): string {
  let hash = 0;
  const str = `${title}-${start}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `${Math.abs(hash)}@rallia.com`;
}

Deno.serve(async req => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const title = url.searchParams.get('title');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const location = url.searchParams.get('location') || '';
  const description = url.searchParams.get('description') || '';

  if (!title || !start || !end) {
    return new Response(JSON.stringify({ error: 'Missing required params: title, start, end' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate date formats
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return new Response(JSON.stringify({ error: 'Invalid date format. Use ISO 8601.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = formatIcsDate(new Date().toISOString());
  const uid = generateUid(title, start);

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rallia//Calendar Event//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `DTSTAMP:${now}`,
    `UID:${uid}`,
    `SUMMARY:${escapeIcsText(title)}`,
    location ? `LOCATION:${escapeIcsText(location)}` : '',
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');

  return new Response(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="match.ics"',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    },
  });
});
