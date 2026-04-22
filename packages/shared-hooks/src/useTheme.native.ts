import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@rallia/theme-preference';

/**
 * User's theme preference
 * - 'light': Always use light theme
 * - 'dark': Always use dark theme
 * - 'system': Follow device system setting
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * The actual resolved theme being applied
 * Always either 'light' or 'dark' (system is resolved to one of these)
 */
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  /** The actual theme being applied ('light' or 'dark') */
  theme: ResolvedTheme;
  /** User's preference ('light', 'dark', or 'system') */
  themePreference: ThemePreference;
  /** Set theme preference */
  setThemePreference: (preference: ThemePreference) => void;
  /** Whether the theme is still loading from storage */
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  themePreference: 'system',
  setThemePreference: () => {},
  isLoading: true,
});

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Default preference to use if none is stored (defaults to 'system') */
  defaultPreference?: ThemePreference;
}

export function ThemeProvider({ children, defaultPreference = 'system' }: ThemeProviderProps) {
  const colorScheme = useColorScheme();
  const systemTheme: ResolvedTheme = colorScheme === 'dark' ? 'dark' : 'light';
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(defaultPreference);
  const [isLoading, setIsLoading] = useState(true);
  const previousPreferenceRef = useRef<ThemePreference>(defaultPreference);

  // Load saved preference on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored && ['light', 'dark', 'system'].includes(stored)) {
          const storedPreference = stored as ThemePreference;
          setThemePreferenceState(storedPreference);
          previousPreferenceRef.current = storedPreference;
        }
      } catch (error) {
        console.error('Error loading theme preference:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadTheme();
  }, []);

  // Resolve the actual theme based on preference and system setting
  const theme: ResolvedTheme = useMemo(() => {
    if (themePreference === 'system') {
      return systemTheme;
    }
    return themePreference;
  }, [themePreference, systemTheme]);

  // Persist preference when changed
  const setThemePreference = useCallback(
    async (preference: ThemePreference) => {
      const oldPreference = previousPreferenceRef.current;
      const oldResolvedTheme = oldPreference === 'system' ? systemTheme : oldPreference;
      const newResolvedTheme = preference === 'system' ? systemTheme : preference;

      setThemePreferenceState(preference);
      previousPreferenceRef.current = preference;

      try {
        await AsyncStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch (error) {
        console.error('Error saving theme preference:', error);
      }
    },
    [systemTheme]
  );

  const value = useMemo(
    () => ({
      theme,
      themePreference,
      setThemePreference,
      isLoading,
    }),
    [theme, themePreference, setThemePreference, isLoading]
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

/**
 * Hook to access theme context
 *
 * @example
 * ```tsx
 * const { theme, themePreference, setThemePreference } = useTheme();
 *
 * // theme is always 'light' or 'dark' (resolved)
 * const backgroundColor = theme === 'dark' ? '#000' : '#fff';
 *
 * // Change preference
 * setThemePreference('dark');
 * ```
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
