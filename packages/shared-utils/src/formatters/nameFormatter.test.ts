import { getInitialName } from './nameFormatter';

describe('getInitialName', () => {
  it('renders first name plus last initial', () => {
    expect(getInitialName({ first_name: 'Mathis', last_name: 'Lefranc' })).toBe('Mathis L.');
  });

  it('uppercases a lowercase last name', () => {
    expect(getInitialName({ first_name: 'Marie', last_name: 'tremblay' })).toBe('Marie T.');
  });

  it('keeps accented initials intact', () => {
    expect(getInitialName({ first_name: 'Jean', last_name: 'Étienne' })).toBe('Jean É.');
  });

  it('handles hyphenated and compound names by initialing the first character', () => {
    expect(getInitialName({ first_name: 'Jean-Daniel', last_name: 'Sonkin' })).toBe(
      'Jean-Daniel S.'
    );
    expect(getInitialName({ first_name: 'Anne', last_name: 'de Villiers' })).toBe('Anne D.');
  });

  it('falls back to the first name alone when there is no last name', () => {
    expect(getInitialName({ first_name: 'Mathis', last_name: null })).toBe('Mathis');
    expect(getInitialName({ first_name: 'Mathis', last_name: '   ' })).toBe('Mathis');
  });

  it('uses the fallback when there is no first name', () => {
    expect(getInitialName({ first_name: null, last_name: 'Lefranc' }, 'Player')).toBe('Player');
    expect(getInitialName(null, 'Player')).toBe('Player');
    expect(getInitialName(undefined, '')).toBe('');
  });

  it('ignores display_name, like the other name helpers', () => {
    expect(
      getInitialName({ first_name: 'Mathis', last_name: 'Lefranc', display_name: 'MattyL' })
    ).toBe('Mathis L.');
  });

  it('trims surrounding whitespace', () => {
    expect(getInitialName({ first_name: '  Mathis  ', last_name: '  Lefranc  ' })).toBe(
      'Mathis L.'
    );
  });
});
