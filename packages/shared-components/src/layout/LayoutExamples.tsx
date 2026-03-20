import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Container } from './Container.native';
import { Stack, VStack, HStack } from './Stack.native';
import { Card } from './Card.native';
import { Divider } from './Divider.native';
import { Spacer } from './Spacer.native';
import { Text } from '../foundation/Text.native';
import { Heading } from '../foundation/Heading.native';
import { Button } from '../foundation/Button.native';

/**
 * Example 1: Basic Container Usage
 *
 * Demonstrates how Container provides consistent padding and max-width
 */
export const ContainerExample: React.FC = () => {
  return (
    <ScrollView>
      {/* Basic container with default padding */}
      <Container>
        <Heading level={2}>Default Container</Heading>
        <Text>This container has default padding (16px) on all sides.</Text>
      </Container>

      <Spacer size={32} />

      {/* Container with custom padding */}
      <Container padding={24} backgroundColor="#f5f5f5">
        <Heading level={2}>Custom Padding</Heading>
        <Text>This container has 24px padding and a gray background.</Text>
      </Container>

      <Spacer size={32} />

      {/* Container with max width (centered) */}
      <Container maxWidth={600} padding={20}>
        <Heading level={2}>Max Width Container</Heading>
        <Text>
          This container has a maximum width of 600px and will be centered on larger screens.
          Perfect for readable content on tablets and desktops.
        </Text>
      </Container>

      <Spacer size={32} />

      {/* Container with different padding per side */}
      <Container padding={{ horizontal: 24, vertical: 16 }}>
        <Heading level={2}>Asymmetric Padding</Heading>
        <Text>This container has 24px horizontal padding and 16px vertical padding.</Text>
      </Container>
    </ScrollView>
  );
};

/**
 * Example 2: Stack Layouts
 *
 * Demonstrates VStack and HStack for consistent spacing
 */
export const StackExample: React.FC = () => {
  return (
    <Container>
      <Heading level={1}>Stack Examples</Heading>
      <Spacer size={24} />

      {/* Vertical stack */}
      <Card>
        <Heading level={3}>Vertical Stack (VStack)</Heading>
        <Spacer size={16} />
        <VStack spacing={12}>
          <Text>Item 1</Text>
          <Text>Item 2</Text>
          <Text>Item 3</Text>
        </VStack>
      </Card>

      <Spacer size={24} />

      {/* Horizontal stack */}
      <Card>
        <Heading level={3}>Horizontal Stack (HStack)</Heading>
        <Spacer size={16} />
        <HStack spacing={8}>
          <Button variant="primary" onPress={() => {}}>
            Button 1
          </Button>
          <Button variant="secondary" onPress={() => {}}>
            Button 2
          </Button>
          <Button variant="outline" onPress={() => {}}>
            Button 3
          </Button>
        </HStack>
      </Card>

      <Spacer size={24} />

      {/* Stack with alignment */}
      <Card>
        <Heading level={3}>Centered Stack</Heading>
        <Spacer size={16} />
        <VStack spacing={8} align="center">
          <Text>Centered Item 1</Text>
          <Text>Centered Item 2</Text>
          <Text>Centered Item 3</Text>
        </VStack>
      </Card>

      <Spacer size={24} />

      {/* Stack with space-between */}
      <Card>
        <Heading level={3}>Space Between</Heading>
        <Spacer size={16} />
        <HStack justify="space-between">
          <Text>Left</Text>
          <Text>Center</Text>
          <Text>Right</Text>
        </HStack>
      </Card>
    </Container>
  );
};

/**
 * Example 3: Card Variants
 *
 * Demonstrates different card styles
 */
export const CardExample: React.FC = () => {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  return (
    <Container>
      <Heading level={1}>Card Examples</Heading>
      <Spacer size={24} />

      <VStack spacing={16}>
        {/* Default card */}
        <Card>
          <Heading level={3}>Default Card</Heading>
          <Text>This card has a subtle shadow elevation.</Text>
        </Card>

        {/* Outlined card */}
        <Card variant="outlined">
          <Heading level={3}>Outlined Card</Heading>
          <Text>This card has a border instead of a shadow.</Text>
        </Card>

        {/* Elevated card */}
        <Card variant="elevated">
          <Heading level={3}>Elevated Card</Heading>
          <Text>This card has a more prominent shadow.</Text>
        </Card>

        {/* Tappable cards */}
        <Card
          onPress={() => setSelectedCard('card1')}
          backgroundColor={selectedCard === 'card1' ? '#E3F2FD' : '#ffffff'}
        >
          <HStack spacing={12} align="center">
            <Text weight="semibold">Tappable Card 1</Text>
            {selectedCard === 'card1' && <Text>✓ Selected</Text>}
          </HStack>
        </Card>

        <Card
          onPress={() => setSelectedCard('card2')}
          backgroundColor={selectedCard === 'card2' ? '#E3F2FD' : '#ffffff'}
        >
          <HStack spacing={12} align="center">
            <Text weight="semibold">Tappable Card 2</Text>
            {selectedCard === 'card2' && <Text>✓ Selected</Text>}
          </HStack>
        </Card>

        {/* Card with custom padding and border radius */}
        <Card padding={24} borderRadius={20} backgroundColor="#F3E5F5">
          <Heading level={3}>Custom Styled Card</Heading>
          <Text>
            This card has custom padding (24px), border radius (20px), and background color.
          </Text>
        </Card>
      </VStack>
    </Container>
  );
};

/**
 * Example 4: Divider Usage
 *
 * Demonstrates horizontal and vertical dividers
 */
export const DividerExample: React.FC = () => {
  return (
    <Container>
      <Heading level={1}>Divider Examples</Heading>
      <Spacer size={24} />

      <Card>
        {/* Simple horizontal divider */}
        <Text>Section 1</Text>
        <Divider spacing={12} />
        <Text>Section 2</Text>
        <Divider spacing={12} />
        <Text>Section 3</Text>

        <Spacer size={24} />

        {/* Thicker divider */}
        <Text>Content above</Text>
        <Divider thickness={2} spacing={16} />
        <Text>Content below</Text>

        <Spacer size={24} />

        {/* Vertical divider in horizontal layout */}
        <HStack align="center">
          <Text>Left</Text>
          <Divider orientation="vertical" length={20} spacing={12} />
          <Text>Center</Text>
          <Divider orientation="vertical" length={20} spacing={12} />
          <Text>Right</Text>
        </HStack>

        <Spacer size={24} />

        {/* Custom color divider */}
        <Text>Custom Color Divider</Text>
        <Divider color="#2196F3" thickness={3} spacing={12} />
        <Text>Below custom divider</Text>
      </Card>
    </Container>
  );
};

/**
 * Example 5: Spacer Usage
 *
 * Demonstrates fixed and flexible spacers
 */
export const SpacerExample: React.FC = () => {
  return (
    <Container>
      <Heading level={1}>Spacer Examples</Heading>
      <Spacer size={24} />

      <Card>
        {/* Fixed vertical spacer */}
        <Text>Item with 20px spacing below</Text>
        <Spacer size={20} />
        <Text>Item with 20px spacing above</Text>

        <Spacer size={32} />

        {/* Horizontal spacer */}
        <HStack>
          <Text>Left</Text>
          <Spacer size={40} direction="horizontal" />
          <Text>Right (40px gap)</Text>
        </HStack>

        <Spacer size={32} />

        {/* Flexible spacer (pushes content apart) */}
        <HStack>
          <Text>Left</Text>
          <Spacer flex direction="horizontal" />
          <Text>Right (pushed to edge)</Text>
        </HStack>
      </Card>

      <Spacer size={24} />

      {/* Flexible vertical spacer in a fixed height container */}
      <Card padding={0} style={{ height: 300 }}>
        <Container>
          <Text>Top Content</Text>
          <Spacer flex />
          <Button variant="primary" onPress={() => {}}>
            Bottom Button
          </Button>
        </Container>
      </Card>
    </Container>
  );
};

/**
 * Example 6: Real-World Profile Screen
 *
 * Demonstrates combining all layout components
 */
export const ProfileScreenExample: React.FC = () => {
  return (
    <ScrollView style={styles.scrollView}>
      <Container padding={20}>
        {/* Header */}
        <Card variant="elevated" padding={20}>
          <VStack spacing={16} align="center">
            {/* Profile picture placeholder */}
            <Card style={styles.profilePicture} backgroundColor="#E0E0E0">
              <Text>👤</Text>
            </Card>
            <Heading level={2}>John Doe</Heading>
            <Text variant="caption" color="#666">
              john.doe@example.com
            </Text>
          </VStack>
        </Card>

        <Spacer size={24} />

        {/* Stats cards */}
        <HStack spacing={12}>
          <Card style={{ flex: 1 }} variant="outlined">
            <VStack spacing={4} align="center">
              <Heading level={3}>24</Heading>
              <Text variant="caption">Matches</Text>
            </VStack>
          </Card>
          <Card style={{ flex: 1 }} variant="outlined">
            <VStack spacing={4} align="center">
              <Heading level={3}>18</Heading>
              <Text variant="caption">Wins</Text>
            </VStack>
          </Card>
          <Card style={{ flex: 1 }} variant="outlined">
            <VStack spacing={4} align="center">
              <Heading level={3}>75%</Heading>
              <Text variant="caption">Win Rate</Text>
            </VStack>
          </Card>
        </HStack>

        <Spacer size={24} />

        {/* Settings sections */}
        <Card>
          <VStack spacing={0}>
            <Text weight="semibold">Account Settings</Text>
            <Spacer size={12} />
            <Divider />
            <Spacer size={12} />

            <Card variant="outlined" onPress={() => {}}>
              <HStack justify="space-between" align="center">
                <Text>Edit Profile</Text>
                <Text>→</Text>
              </HStack>
            </Card>

            <Spacer size={8} />

            <Card variant="outlined" onPress={() => {}}>
              <HStack justify="space-between" align="center">
                <Text>Change Password</Text>
                <Text>→</Text>
              </HStack>
            </Card>

            <Spacer size={8} />

            <Card variant="outlined" onPress={() => {}}>
              <HStack justify="space-between" align="center">
                <Text>Notification Preferences</Text>
                <Text>→</Text>
              </HStack>
            </Card>
          </VStack>
        </Card>

        <Spacer size={24} />

        {/* Logout button */}
        <Button variant="outline" onPress={() => {}}>
          Log Out
        </Button>

        <Spacer size={40} />
      </Container>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  profilePicture: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
