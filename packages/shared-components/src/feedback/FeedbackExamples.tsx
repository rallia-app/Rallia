import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Container } from '../layout/Container.native';
import { VStack, HStack } from '../layout/Stack.native';
import { Card } from '../layout/Card.native';
import { Spacer } from '../layout/Spacer.native';
import { Divider } from '../layout/Divider.native';
import { Spinner } from './Spinner.native';
import { ErrorMessage } from './ErrorMessage.native';
import { Badge } from './Badge.native';
import { Text } from '../foundation/Text.native';
import { Heading } from '../foundation/Heading.native';
import { Button } from '../foundation/Button.native';

/**
 * Example 1: Spinner Usage
 *
 * Demonstrates different spinner sizes and colors
 */
export const SpinnerExample: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleLoad = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <Container>
      <Heading level={1}>Spinner Examples</Heading>
      <Spacer size={24} />

      {/* Different sizes */}
      <Card>
        <Heading level={3}>Sizes</Heading>
        <Spacer size={16} />
        <HStack spacing={24} align="center">
          <VStack spacing={8} align="center">
            <Spinner size="sm" />
            <Text variant="caption">Small</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner size="md" />
            <Text variant="caption">Medium</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner size="lg" />
            <Text variant="caption">Large</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner size="xl" />
            <Text variant="caption">Extra Large</Text>
          </VStack>
        </HStack>
      </Card>

      <Spacer size={24} />

      {/* Different colors */}
      <Card>
        <Heading level={3}>Colors</Heading>
        <Spacer size={16} />
        <HStack spacing={24} align="center">
          <VStack spacing={8} align="center">
            <Spinner color="#2196F3" />
            <Text variant="caption">Blue</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner color="#4CAF50" />
            <Text variant="caption">Green</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner color="#FF9800" />
            <Text variant="caption">Orange</Text>
          </VStack>
          <VStack spacing={8} align="center">
            <Spinner color="#F44336" />
            <Text variant="caption">Red</Text>
          </VStack>
        </HStack>
      </Card>

      <Spacer size={24} />

      {/* In buttons */}
      <Card>
        <Heading level={3}>In Buttons</Heading>
        <Spacer size={16} />
        <VStack spacing={12}>
          <Button variant="primary" onPress={handleLoad} disabled={loading}>
            <HStack spacing={8} align="center">
              {loading && <Spinner size="sm" color="#fff" />}
              <Text color="#fff">{loading ? 'Loading...' : 'Load Data'}</Text>
            </HStack>
          </Button>

          <Button variant="outline" disabled={loading}>
            <HStack spacing={8} align="center">
              {loading && <Spinner size="sm" />}
              <Text>{loading ? 'Processing...' : 'Process'}</Text>
            </HStack>
          </Button>
        </VStack>
      </Card>

      <Spacer size={24} />

      {/* Centered spinner */}
      <Card style={{ height: 200 }}>
        <Heading level={3}>Centered (Full Container)</Heading>
        <Spinner center />
      </Card>
    </Container>
  );
};

/**
 * Example 2: ErrorMessage Usage
 *
 * Demonstrates different error message variants
 */
export const ErrorMessageExample: React.FC = () => {
  const [retryCount, setRetryCount] = useState(0);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };

  return (
    <ScrollView style={styles.scrollView}>
      <Container>
        <Heading level={1}>ErrorMessage Examples</Heading>
        <Spacer size={24} />

        {/* Default variant */}
        <Card>
          <Heading level={3}>Default Variant</Heading>
          <Spacer size={16} />
          <ErrorMessage message="Failed to load data from the server." onRetry={handleRetry} />
          {retryCount > 0 && (
            <>
              <Spacer size={8} />
              <Text variant="caption">Retry count: {retryCount}</Text>
            </>
          )}
        </Card>

        <Spacer size={24} />

        {/* Custom title and message */}
        <Card>
          <Heading level={3}>Custom Title</Heading>
          <Spacer size={16} />
          <ErrorMessage
            title="Network Error"
            message="Unable to connect to the server. Please check your internet connection."
            onRetry={() => {}}
            retryText="Reconnect"
          />
        </Card>

        <Spacer size={24} />

        {/* Inline variant (for forms) */}
        <Card>
          <Heading level={3}>Inline Variant (Forms)</Heading>
          <Spacer size={16} />
          <Text weight="semibold">Email</Text>
          <Spacer size={8} />
          <View style={styles.inputPlaceholder}>
            <Text color="#999">john@example.com</Text>
          </View>
          <Spacer size={8} />
          <ErrorMessage
            variant="inline"
            message="Please enter a valid email address"
            showIcon={false}
          />
        </Card>

        <Spacer size={24} />

        {/* Without retry button */}
        <Card>
          <Heading level={3}>Without Retry</Heading>
          <Spacer size={16} />
          <ErrorMessage
            title="Access Denied"
            message="You don't have permission to access this resource."
          />
        </Card>

        <Spacer size={24} />

        {/* Custom icon */}
        <Card>
          <Heading level={3}>Custom Icon</Heading>
          <Spacer size={16} />
          <ErrorMessage
            title="Authentication Failed"
            message="Your session has expired. Please log in again."
            icon="🔒"
            onRetry={() => {}}
            retryText="Log In"
          />
        </Card>

        <Spacer size={24} />

        {/* Centered variant (full-screen) */}
        <Card style={{ height: 400 }}>
          <ErrorMessage
            variant="centered"
            title="Something went wrong"
            message="We couldn't load your matches. This might be a temporary issue."
            icon="😕"
            onRetry={() => {}}
          />
        </Card>

        <Spacer size={40} />
      </Container>
    </ScrollView>
  );
};

/**
 * Example 3: Badge Usage
 *
 * Demonstrates different badge variants and use cases
 */
export const BadgeExample: React.FC = () => {
  return (
    <ScrollView style={styles.scrollView}>
      <Container>
        <Heading level={1}>Badge Examples</Heading>
        <Spacer size={24} />

        {/* Variants */}
        <Card>
          <Heading level={3}>Variants</Heading>
          <Spacer size={16} />
          <HStack spacing={8} wrap>
            <Badge variant="default">Default</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="info">Info</Badge>
          </HStack>
        </Card>

        <Spacer size={24} />

        {/* Sizes */}
        <Card>
          <Heading level={3}>Sizes</Heading>
          <Spacer size={16} />
          <HStack spacing={8} align="center">
            <Badge size="sm" variant="primary">
              Small
            </Badge>
            <Badge size="md" variant="primary">
              Medium
            </Badge>
            <Badge size="lg" variant="primary">
              Large
            </Badge>
          </HStack>
        </Card>

        <Spacer size={24} />

        {/* Outline style */}
        <Card>
          <Heading level={3}>Outline Style</Heading>
          <Spacer size={16} />
          <HStack spacing={8} wrap>
            <Badge variant="primary" outline>
              Primary
            </Badge>
            <Badge variant="success" outline>
              Success
            </Badge>
            <Badge variant="warning" outline>
              Warning
            </Badge>
            <Badge variant="error" outline>
              Error
            </Badge>
            <Badge variant="info" outline>
              Info
            </Badge>
          </HStack>
        </Card>

        <Spacer size={24} />

        {/* With icons */}
        <Card>
          <Heading level={3}>With Icons</Heading>
          <Spacer size={16} />
          <HStack spacing={8} wrap>
            <Badge variant="success" icon={<Text>✓</Text>}>
              Verified
            </Badge>
            <Badge variant="warning" icon={<Text>⚠</Text>}>
              Pending
            </Badge>
            <Badge variant="error" icon={<Text>✕</Text>}>
              Failed
            </Badge>
            <Badge variant="info" icon={<Text>ℹ</Text>}>
              Info
            </Badge>
          </HStack>
        </Card>

        <Spacer size={24} />

        {/* Custom colors */}
        <Card>
          <Heading level={3}>Custom Colors</Heading>
          <Spacer size={16} />
          <HStack spacing={8} wrap>
            <Badge backgroundColor="#9C27B0" textColor="#fff">
              Purple
            </Badge>
            <Badge backgroundColor="#00BCD4" textColor="#fff">
              Cyan
            </Badge>
            <Badge backgroundColor="#CDDC39" textColor="#000">
              Lime
            </Badge>
            <Badge backgroundColor="#795548" textColor="#fff">
              Brown
            </Badge>
          </HStack>
        </Card>

        <Spacer size={24} />

        {/* Real-world examples */}
        <Card>
          <Heading level={3}>Match Status Example</Heading>
          <Spacer size={16} />

          {/* Match card with badges */}
          <Card variant="outlined">
            <VStack spacing={12}>
              <Heading level={4}>Saturday Tennis Match</Heading>
              <HStack spacing={8} wrap>
                <Badge variant="info" icon={<Text>🎾</Text>}>
                  Tennis
                </Badge>
                <Badge variant="success">4/4 Players</Badge>
                <Badge variant="warning">Intermediate</Badge>
                <Badge variant="default">Outdoor</Badge>
              </HStack>
              <Divider spacing={12} />
              <HStack justify="space-between" align="center">
                <Text variant="caption">Tomorrow at 2:00 PM</Text>
                <Badge variant="primary" size="sm">
                  Confirmed
                </Badge>
              </HStack>
            </VStack>
          </Card>
        </Card>

        <Spacer size={24} />

        {/* Player skill levels */}
        <Card>
          <Heading level={3}>Skill Level Indicators</Heading>
          <Spacer size={16} />
          <VStack spacing={12}>
            <HStack spacing={8}>
              <Badge variant="success" size="sm">
                Beginner
              </Badge>
              <Text>John Doe</Text>
            </HStack>
            <HStack spacing={8}>
              <Badge variant="warning" size="sm">
                Intermediate
              </Badge>
              <Text>Jane Smith</Text>
            </HStack>
            <HStack spacing={8}>
              <Badge variant="error" size="sm">
                Advanced
              </Badge>
              <Text>Mike Johnson</Text>
            </HStack>
            <HStack spacing={8}>
              <Badge variant="primary" size="sm">
                Professional
              </Badge>
              <Text>Sarah Williams</Text>
            </HStack>
          </VStack>
        </Card>

        <Spacer size={24} />

        {/* Notification badges */}
        <Card>
          <Heading level={3}>Notification Badges</Heading>
          <Spacer size={16} />
          <VStack spacing={16}>
            <HStack justify="space-between" align="center">
              <Text>New Messages</Text>
              <Badge variant="error" size="sm" rounded>
                12
              </Badge>
            </HStack>
            <Divider />
            <HStack justify="space-between" align="center">
              <Text>Pending Invitations</Text>
              <Badge variant="warning" size="sm" rounded>
                3
              </Badge>
            </HStack>
            <Divider />
            <HStack justify="space-between" align="center">
              <Text>Upcoming Matches</Text>
              <Badge variant="info" size="sm" rounded>
                5
              </Badge>
            </HStack>
          </VStack>
        </Card>

        <Spacer size={40} />
      </Container>
    </ScrollView>
  );
};

/**
 * Example 4: Combined Usage
 *
 * Demonstrates using all feedback components together
 */
export const CombinedFeedbackExample: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [data, setData] = useState<any>(null);

  const loadData = () => {
    setIsLoading(true);
    setHasError(false);

    // Simulate API call
    setTimeout(() => {
      const success = Math.random() > 0.3;

      if (success) {
        setData({
          matches: [
            { id: 1, name: 'Tennis Match', status: 'confirmed', players: 4 },
            { id: 2, name: 'Basketball Game', status: 'pending', players: 3 },
          ],
        });
        setHasError(false);
      } else {
        setHasError(true);
      }

      setIsLoading(false);
    }, 2000);
  };

  return (
    <Container>
      <Heading level={1}>Combined Example</Heading>
      <Spacer size={24} />

      <Card>
        <VStack spacing={16}>
          <HStack justify="space-between" align="center">
            <Heading level={3}>My Matches</Heading>
            <Badge variant="info">{data?.matches?.length || 0} matches</Badge>
          </HStack>

          <Divider />

          {/* Loading state */}
          {isLoading && (
            <VStack spacing={12} align="center">
              <Spinner size="lg" />
              <Text variant="caption">Loading matches...</Text>
            </VStack>
          )}

          {/* Error state */}
          {!isLoading && hasError && (
            <ErrorMessage
              title="Failed to Load"
              message="We couldn't load your matches. Please try again."
              onRetry={loadData}
            />
          )}

          {/* Success state */}
          {!isLoading && !hasError && data && (
            <VStack spacing={12}>
              {data.matches.map((match: any) => (
                <Card key={match.id} variant="outlined">
                  <VStack spacing={8}>
                    <HStack justify="space-between" align="center">
                      <Text weight="semibold">{match.name}</Text>
                      <Badge
                        variant={match.status === 'confirmed' ? 'success' : 'warning'}
                        size="sm"
                      >
                        {match.status}
                      </Badge>
                    </HStack>
                    <HStack spacing={8}>
                      <Badge variant="info" size="sm">
                        {match.players}/4 players
                      </Badge>
                    </HStack>
                  </VStack>
                </Card>
              ))}
            </VStack>
          )}

          {/* Initial state */}
          {!isLoading && !hasError && !data && (
            <VStack spacing={16} align="center">
              <Text variant="caption">No matches loaded</Text>
              <Button variant="primary" onPress={loadData}>
                Load Matches
              </Button>
            </VStack>
          )}
        </VStack>
      </Card>
    </Container>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  inputPlaceholder: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
});
