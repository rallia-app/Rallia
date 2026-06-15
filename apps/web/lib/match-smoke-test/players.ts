import type { RatingOption } from './constants';

export interface FakePlayerTemplate {
  id: string;
  firstName: string;
  rating: number;
  gamesPlayed: number;
  club: string;
}

const PLAYER_POOL: FakePlayerTemplate[] = [
  { id: 'marc-l', firstName: 'Marc', rating: 4.0, gamesPlayed: 47, club: 'Club Mont-Royal' },
  { id: 'sophie-d', firstName: 'Sophie', rating: 3.5, gamesPlayed: 23, club: 'Parc Jeanne-Mance' },
  { id: 'alex-t', firstName: 'Alex', rating: 4.5, gamesPlayed: 61, club: 'Verdun Tennis' },
  { id: 'priya-k', firstName: 'Priya', rating: 3.0, gamesPlayed: 12, club: 'Outremont Club' },
  { id: 'luc-b', firstName: 'Luc', rating: 5.0, gamesPlayed: 89, club: 'Stade IGA' },
  { id: 'emma-r', firstName: 'Emma', rating: 4.0, gamesPlayed: 34, club: 'La Fontaine' },
  { id: 'noah-w', firstName: 'Noah', rating: 3.5, gamesPlayed: 19, club: 'Rosemont courts' },
  { id: 'camille-h', firstName: 'Camille', rating: 4.5, gamesPlayed: 52, club: 'Westmount CC' },
];

function parseRating(rating: RatingOption): number {
  return Number.parseFloat(rating);
}

export function pickFakePlayer(rating: RatingOption): FakePlayerTemplate {
  const target = parseRating(rating);
  const candidates = PLAYER_POOL.filter(p => Math.abs(p.rating - target) <= 0.5);
  const pool = candidates.length > 0 ? candidates : PLAYER_POOL;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function randomDistanceKm(): number {
  return Math.round((1.2 + Math.random() * 6.6) * 10) / 10;
}

export function playerInitials(firstName: string): string {
  return firstName.slice(0, 2).toUpperCase();
}
