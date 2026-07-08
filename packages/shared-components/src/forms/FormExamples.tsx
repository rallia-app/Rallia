/**
 * Form Components Usage Examples
 *
 * This file demonstrates how to build complete forms using the
 * Input, Select, and Button components from the shared-components package.
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Input, Select, Button, Heading, Text, SelectOption } from '@rallia/shared-components';
import { colors, spacing } from '../theme';

// Example 1: Simple Contact Form
export const ContactForm: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    }
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Invalid email address';
    }
    if (!message.trim()) {
      newErrors.message = 'Message is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Submit form
    console.log('Form submitted:', { name, email, message });
    setErrors({});
  };

  return (
    <View style={styles.card}>
      <Heading level={3}>Contact Us</Heading>
      <Text variant="caption" style={styles.marginTop}>
        Fill out the form below and we'll get back to you soon.
      </Text>

      <View style={styles.marginTop}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          error={errors.name}
          required
          placeholder="Enter your name"
        />
      </View>

      <Input
        label="Email"
        type="email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        required
        placeholder="Enter your email"
        leftIcon={<Text>📧</Text>}
      />

      <Input
        label="Message"
        value={message}
        onChangeText={setMessage}
        error={errors.message}
        required
        placeholder="Enter your message"
        multiline
        numberOfLines={4}
        maxLength={500}
        showCharCount
      />

      <Button variant="primary" onPress={handleSubmit} style={styles.marginTop}>
        Send Message
      </Button>
    </View>
  );
};

// Example 2: Profile Settings Form
export const ProfileSettingsForm: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [bio, setBio] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

  const genderOptions: SelectOption[] = [
    { label: 'Male', value: 'male' },
    { label: 'Female', value: 'female' },
    { label: 'Non-binary', value: 'non-binary' },
    { label: 'Prefer not to say', value: 'prefer-not-to-say' },
  ];

  return (
    <ScrollView style={styles.container}>
      <Heading level={2}>Profile Settings</Heading>

      <View style={styles.section}>
        <Heading level={4}>Personal Information</Heading>

        <Input
          label="Full Name"
          value={fullName}
          onChangeText={setFullName}
          required
          placeholder="John Doe"
        />

        <Input
          label="Email"
          type="email"
          value={email}
          onChangeText={setEmail}
          required
          placeholder="john@example.com"
          helperText="We'll never share your email"
        />

        <Input
          label="Phone Number"
          type="phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+1 (555) 123-4567"
        />

        <Select
          label="Gender"
          value={gender}
          onChange={setGender}
          options={genderOptions}
          required
        />

        <Input
          label="Bio"
          value={bio}
          onChangeText={setBio}
          placeholder="Tell us about yourself"
          multiline
          numberOfLines={4}
          maxLength={200}
          showCharCount
          helperText="Write a short bio about yourself"
        />
      </View>

      <View style={styles.section}>
        <Heading level={4}>Security</Heading>

        <Input
          label="New Password"
          type="password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter new password"
          helperText="Must be at least 8 characters"
        />
      </View>

      <View style={styles.buttonGroup}>
        <Button variant="outline" onPress={() => console.log('Cancel')}>
          Cancel
        </Button>
        <Button variant="primary" onPress={() => console.log('Save')}>
          Save Changes
        </Button>
      </View>
    </ScrollView>
  );
};

// Example 3: Match Creation Form
export const MatchCreationForm: React.FC = () => {
  const [matchName, setMatchName] = useState('');
  const [sport, setSport] = useState('');
  const [skill, setSkill] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('');
  const [description, setDescription] = useState('');

  const sportOptions: SelectOption[] = [
    { label: 'Tennis', value: 'tennis' },
    { label: 'Badminton', value: 'badminton' },
    { label: 'Pickleball', value: 'pickleball' },
  ];

  const skillOptions: SelectOption[] = [
    { label: 'Beginner', value: 'beginner' },
    { label: 'Intermediate', value: 'intermediate' },
    { label: 'Advanced', value: 'advanced' },
    { label: 'Professional', value: 'professional' },
  ];

  return (
    <View style={styles.card}>
      <Heading level={3}>Create New Match</Heading>

      <Input
        label="Match Name"
        value={matchName}
        onChangeText={setMatchName}
        required
        placeholder="Saturday Morning Game"
      />

      <Select label="Sport" value={sport} onChange={setSport} options={sportOptions} required />

      <Select
        label="Skill Level"
        value={skill}
        onChange={setSkill}
        options={skillOptions}
        required
        helperText="Select the expected skill level"
      />

      <Input
        label="Max Players"
        type="number"
        value={maxPlayers}
        onChangeText={setMaxPlayers}
        required
        placeholder="4"
        helperText="Maximum number of players allowed"
      />

      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Add match details..."
        multiline
        numberOfLines={3}
      />

      <Button
        variant="primary"
        onPress={() => console.log('Create Match')}
        fullWidth
        style={styles.marginTop}
      >
        Create Match
      </Button>
    </View>
  );
};

// Example 4: Search Form with Filters
export const SearchForm: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');

  const categoryOptions: SelectOption[] = [
    { label: 'All Categories', value: '' },
    { label: 'Matches', value: 'matches' },
    { label: 'Players', value: 'players' },
    { label: 'Courts', value: 'courts' },
  ];

  return (
    <View style={styles.searchContainer}>
      <Input
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search..."
        leftIcon={<Text>🔍</Text>}
        rightIcon={searchQuery ? <Text onPress={() => setSearchQuery('')}>✕</Text> : null}
      />

      <View style={styles.filterRow}>
        <View style={styles.filterItem}>
          <Select
            value={category}
            onChange={setCategory}
            options={categoryOptions}
            placeholder="Category"
          />
        </View>

        <View style={styles.filterItem}>
          <Input
            value={location}
            onChangeText={setLocation}
            placeholder="Location"
            leftIcon={<Text>📍</Text>}
          />
        </View>
      </View>

      <Button variant="primary" onPress={() => console.log('Search')}>
        Search
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing[4],
    backgroundColor: colors.backgroundGray,
  },
  card: {
    backgroundColor: colors.white,
    padding: spacing[4],
    borderRadius: 12,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  section: {
    marginTop: spacing[6],
  },
  marginTop: {
    marginTop: spacing[4],
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[6],
  },
  searchContainer: {
    padding: spacing[4],
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  filterItem: {
    flex: 1,
  },
});

export default {
  ContactForm,
  ProfileSettingsForm,
  MatchCreationForm,
  SearchForm,
};
