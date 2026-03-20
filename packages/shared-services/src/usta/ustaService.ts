/**
 * USTA Connect API Service
 *
 * Integrates with USTA's API to fetch player NTRP ratings and profile information.
 * Requires OAuth2 authentication with USTA Connect.
 *
 * Documentation: https://developer.usta.com/
 */

export interface USTANTRPRating {
  ntrpRating: number;
  ratingType: 'C' | 'A' | 'S' | 'D'; // C=Computer, A=Appeal, S=Self-rated, D=Dynamic
  benchmarkType: string;
  ratingDate: string; // ISO date
  ratingExpiration: string; // ISO date
  ratingYear: number;
}

export interface USTAPlayerProfile {
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  yearOfBirth: string;
  addresses: Array<{
    city: string;
    state: string;
  }>;
}

export interface USTAAuthConfig {
  clientId: string;
  clientSecret: string;
  environment: 'production' | 'stage';
}

export interface USTAAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

class USTAService {
  private config: USTAAuthConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(config: USTAAuthConfig) {
    this.config = config;
  }

  /**
   * Get the base URL for the USTA API based on environment
   */
  private getBaseUrl(): string {
    return this.config.environment === 'production'
      ? 'https://api-ustaconnect.usta.com/v1/usta-service'
      : 'https://stage-api-ustaconnect.usta.com/v1/usta-service';
  }

  /**
   * Get the OAuth2 token URL
   */
  private getTokenUrl(): string {
    return this.config.environment === 'production'
      ? 'https://account-ustaconnect.usta.com/oauth/token'
      : 'https://stage-account-ustaconnect.usta.com/oauth/token';
  }

  /**
   * Get the audience URL for OAuth2
   */
  private getAudience(): string {
    return this.config.environment === 'production'
      ? 'https://api-ustaconnect.usta.com'
      : 'https://external-stage-services.usta.com';
  }

  /**
   * Authenticate with USTA Connect using OAuth2 Client Credentials flow
   * Based on USTA's OKTA Auth0 integration guide
   */
  private async authenticate(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      // USTA uses application/json for OAuth2 token requests
      const response = await fetch(this.getTokenUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          audience: this.getAudience(),
        }),
      });

      if (!response.ok) {
        throw new Error(`USTA authentication failed: ${response.statusText}`);
      }

      const data = (await response.json()) as USTAAccessToken;

      // Store token with 5 minute buffer before expiry
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

      return this.accessToken;
    } catch (error) {
      console.error('USTA authentication error:', error);
      throw new Error('Failed to authenticate with USTA Connect');
    }
  }

  /**
   * Fetch NTRP rating for a player by their USTA ID (UAID)
   *
   * @param uaid - USTA Universal Account ID
   * @returns Player's NTRP rating information or null if not found
   */
  async fetchNTRPRating(uaid: string): Promise<USTANTRPRating | null> {
    try {
      const token = await this.authenticate();
      const url = `${this.getBaseUrl()}/customers/${uaid}/ntrp`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        // Player not found or no rating available
        return null;
      }

      if (!response.ok) {
        throw new Error(`USTA API error: ${response.statusText}`);
      }

      const data = (await response.json()) as USTANTRPRating;
      return data;
    } catch (error) {
      console.error('Error fetching NTRP rating:', error);
      throw error;
    }
  }

  /**
   * Fetch limited profile information for a player by their USTA ID
   *
   * @param uaid - USTA Universal Account ID
   * @returns Player's profile information or null if not found
   */
  async fetchPlayerProfile(uaid: string): Promise<USTAPlayerProfile | null> {
    try {
      const token = await this.authenticate();
      const url = `${this.getBaseUrl()}/customers/${uaid}/information/limited`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        // Player not found
        return null;
      }

      if (!response.ok) {
        throw new Error(`USTA API error: ${response.statusText}`);
      }

      const data = (await response.json()) as USTAPlayerProfile;
      return data;
    } catch (error) {
      console.error('Error fetching player profile:', error);
      throw error;
    }
  }

  /**
   * Verify a player's NTRP rating and profile information
   *
   * @param uaid - USTA Universal Account ID
   * @returns Combined rating and profile data, or null if not found
   */
  async verifyPlayer(uaid: string): Promise<{
    rating: USTANTRPRating | null;
    profile: USTAPlayerProfile | null;
  }> {
    const [rating, profile] = await Promise.all([
      this.fetchNTRPRating(uaid),
      this.fetchPlayerProfile(uaid),
    ]);

    return { rating, profile };
  }

  /**
   * Check if a rating is still valid (not expired)
   */
  isRatingValid(rating: USTANTRPRating): boolean {
    const expirationDate = new Date(rating.ratingExpiration);
    return expirationDate > new Date();
  }

  /**
   * Get a human-readable rating type description
   */
  getRatingTypeDescription(ratingType: string): string {
    const types: Record<string, string> = {
      C: 'Computer Rated',
      A: 'Appeal Rated',
      S: 'Self Rated',
      D: 'Dynamic Rated',
    };
    return types[ratingType] || 'Unknown';
  }
}

// Singleton instance
let ustaServiceInstance: USTAService | null = null;

/**
 * Initialize the USTA service with configuration
 * Should be called once at app startup
 */
export const initializeUSTAService = (config: USTAAuthConfig): void => {
  ustaServiceInstance = new USTAService(config);
};

/**
 * Get the USTA service instance
 * Throws error if not initialized
 */
export const getUSTAService = (): USTAService => {
  if (!ustaServiceInstance) {
    throw new Error('USTA service not initialized. Call initializeUSTAService first.');
  }
  return ustaServiceInstance;
};

export default USTAService;
