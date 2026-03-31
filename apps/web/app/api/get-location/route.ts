import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get IP address from various headers
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfConnectingIp = request.headers.get('cf-connecting-ip');

    const ipAddress = cfConnectingIp || forwarded?.split(',')[0] || realIp || 'unknown';

    let location = 'unknown, unknown';
    let country = 'unknown';
    let latitude: number | null = null;
    let longitude: number | null = null;

    // Skip geolocation for localhost/private IPs
    if (ipAddress !== 'unknown' && !isLocalOrPrivateIP(ipAddress)) {
      try {
        // Call ipapi.co API for geolocation
        const response = await fetch(`https://ipapi.co/${ipAddress}/json/`, {
          method: 'GET',
          headers: {
            'User-Agent': 'Rallia-Waitlist/1.0',
          },
        });

        if (response.ok) {
          const data = await response.json();

          // Check if API returned valid data
          if (data.city && data.country_name) {
            location = `${data.city}, ${data.country_name}`;
            country = data.country_name;
            latitude = data.latitude ?? null;
            longitude = data.longitude ?? null;
          } else if (data.error) {
            console.warn('ipapi.co error:', data.error);
          }
        } else {
          console.warn('ipapi.co API request failed:', response.status);
        }
      } catch (apiError) {
        console.warn('Error calling ipapi.co:', apiError);
      }
    }

    return NextResponse.json({
      ipAddress,
      location,
      country,
      latitude,
      longitude,
    });
  } catch (error) {
    console.error('Error getting location:', error);
    return NextResponse.json(
      {
        ipAddress: 'unknown',
        location: 'unknown, unknown',
        country: 'unknown',
      },
      { status: 200 }
    );
  }
}

// Helper function to check if IP is localhost or private
function isLocalOrPrivateIP(ip: string): boolean {
  if (ip === 'unknown') return true;

  // Check for localhost
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;

  // Check for private IP ranges
  const privateRanges = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^fc00:/, // IPv6 private
    /^fe80:/, // IPv6 link-local
  ];

  return privateRanges.some(range => range.test(ip));
}
