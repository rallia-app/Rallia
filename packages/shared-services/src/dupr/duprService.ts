/**
 * DUPR API Service
 *
 * Integrates with DUPR (Dynamic Universal Pickleball Rating) API to fetch player ratings.
 * DUPR provides ratings for both Tennis and Pickleball, with separate Singles/Doubles ratings.
 *
 * Documentation: https://backend.mydupr.com/swagger-ui/
 */

export interface DUPRRating {
  singles: string; // e.g., "4.125"
  singlesVerified: string; // e.g., "4.1"
  singlesProvisional: boolean;
  singlesReliabilityScore: number; // 0-10, higher = more reliable
  doubles: string; // e.g., "2.864"
  doublesVerified: string; // e.g., "2.75"
  doublesProvisional: boolean;
  doublesReliabilityScore: number; // 0-10, higher = more reliable
  defaultRating: 'SINGLES' | 'DOUBLES';
  provisionalRatings?: {
    singlesRating: number;
    doublesRating: number;
    coach?: string; // JSON string: "{ id: 12345, metadata: { name: example }}"
  };
}

export interface DUPRPlayerProfile {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface DUPRAuthConfig {
  apiKey: string;
  environment: 'production'; // DUPR only has production
}

export interface DUPRApiResponse<T> {
  status: 'SUCCESS' | 'FAILURE';
  message: string;
  result?: T;
}

class DUPRService {
  private config: DUPRAuthConfig;
  private baseUrl = 'https://api.dupr.gg';

  constructor(config: DUPRAuthConfig) {
    this.config = config;
  }

  /**
   * Fetch DUPR rating for a player
   *
   * @param userId - DUPR user ID
   * @returns Player's DUPR rating information or null if not found
   */
  async fetchRating(userId: string): Promise<DUPRRating | null> {
    try {
      const url = `${this.baseUrl}/user/v1.0/rating`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': this.config.apiKey,
          // Include userId in query or header as per actual API requirements
          // This may need adjustment based on actual DUPR API specification
        },
      });

      if (response.status === 404) {
        // Player not found or no rating available
        return null;
      }

      if (response.status === 403) {
        throw new Error('Invalid DUPR API key. Please check your credentials.');
      }

      if (!response.ok) {
        throw new Error(`DUPR API error: ${response.statusText}`);
      }

      const data = (await response.json()) as DUPRApiResponse<DUPRRating>;

      if (data.status === 'FAILURE') {
        throw new Error(data.message || 'DUPR API request failed');
      }

      return data.result || null;
    } catch (error) {
      console.error('Error fetching DUPR rating:', error);
      throw error;
    }
  }

  /**
   * Search for a player by name or email
   * Note: Endpoint may vary - adjust based on actual DUPR API docs
   *
   * @param query - Search query (name or email)
   * @returns Array of matching players
   */
  async searchPlayer(query: string): Promise<DUPRPlayerProfile[]> {
    try {
      // Note: This endpoint is hypothetical - adjust based on actual API
      const url = `${this.baseUrl}/user/v1.0/search?q=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`DUPR API error: ${response.statusText}`);
      }

      const data = (await response.json()) as DUPRApiResponse<DUPRPlayerProfile[]>;

      if (data.status === 'FAILURE') {
        throw new Error(data.message || 'DUPR search failed');
      }

      return data.result || [];
    } catch (error) {
      console.error('Error searching DUPR players:', error);
      throw error;
    }
  }

  /**
   * Verify a player's rating and profile information
   *
   * @param userId - DUPR user ID
   * @returns Rating data or null if not found
   */
  async verifyPlayer(userId: string): Promise<DUPRRating | null> {
    return this.fetchRating(userId);
  }

  /**
   * Check if a rating is reliable based on reliability score
   * Scores above 7 are generally considered reliable
   */
  isRatingReliable(reliabilityScore: number): boolean {
    return reliabilityScore >= 7;
  }

  /**
   * Check if a rating is provisional (still being established)
   */
  isRatingProvisional(rating: DUPRRating, type: 'singles' | 'doubles'): boolean {
    return type === 'singles' ? rating.singlesProvisional : rating.doublesProvisional;
  }

  /**
   * Get the verified rating (more stable than current rating)
   */
  getVerifiedRating(rating: DUPRRating, type: 'singles' | 'doubles'): number {
    const verifiedString = type === 'singles' ? rating.singlesVerified : rating.doublesVerified;
    return parseFloat(verifiedString);
  }

  /**
   * Get the current rating (can fluctuate more)
   */
  getCurrentRating(rating: DUPRRating, type: 'singles' | 'doubles'): number {
    const ratingString = type === 'singles' ? rating.singles : rating.doubles;
    return parseFloat(ratingString);
  }

  /**
   * Get reliability score for a specific type
   */
  getReliabilityScore(rating: DUPRRating, type: 'singles' | 'doubles'): number {
    return type === 'singles' ? rating.singlesReliabilityScore : rating.doublesReliabilityScore;
  }

  /**
   * Format rating display with reliability indicator
   */
  formatRatingDisplay(rating: DUPRRating, type: 'singles' | 'doubles'): string {
    const current = this.getCurrentRating(rating, type);
    const verified = this.getVerifiedRating(rating, type);
    const reliability = this.getReliabilityScore(rating, type);
    const isProvisional = this.isRatingProvisional(rating, type);

    let display = `${current.toFixed(2)}`;

    if (isProvisional) {
      display += ' (Provisional)';
    }

    if (Math.abs(current - verified) > 0.1) {
      display += ` • Verified: ${verified.toFixed(2)}`;
    }

    display += ` • Reliability: ${reliability}/10`;

    return display;
  }
}

// Singleton instance
let duprServiceInstance: DUPRService | null = null;

/**
 * Initialize the DUPR service with configuration
 * Should be called once at app startup
 */
export const initializeDUPRService = (config: DUPRAuthConfig): void => {
  duprServiceInstance = new DUPRService(config);
};

/**
 * Get the DUPR service instance
 * Throws error if not initialized
 */
export const getDUPRService = (): DUPRService => {
  if (!duprServiceInstance) {
    throw new Error('DUPR service not initialized. Call initializeDUPRService first.');
  }
  return duprServiceInstance;
};

export default DUPRService;
