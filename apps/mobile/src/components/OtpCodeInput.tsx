/**
 * OtpCodeInput
 *
 * Inline 6-digit code entry: hidden TextInput + tappable digit boxes.
 * Same interaction pattern as the auth OTPVerificationStep, packaged for
 * inline embedding (owns its hidden input; no cross-step focus handoff).
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, TextInput, Pressable, Platform } from 'react-native';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

interface OtpCodeInputColors {
  text: string;
  cardBackground: string;
  inputBackground: string;
  inputBorder: string;
  buttonActive: string;
}

interface OtpCodeInputProps {
  code: string;
  onCodeChange: (code: string) => void;
  onComplete?: (code: string) => void;
  colors: OtpCodeInputColors;
  autoFocus?: boolean;
  /** Inject the RN TextInput class when rendered inside an actions-sheet ScrollView. */
  TextInputComponent?: React.ComponentType<
    React.ComponentProps<typeof TextInput> & { ref?: React.Ref<TextInput> }
  >;
  testID?: string;
}

const CODE_LENGTH = 6;

export const OtpCodeInput: React.FC<OtpCodeInputProps> = ({
  code,
  onCodeChange,
  onComplete,
  colors,
  autoFocus = true,
  TextInputComponent = TextInput,
  testID = 'otp-code-input',
}) => {
  const hiddenInputRef = useRef<TextInput | null>(null);

  const handleCodeChange = useCallback(
    (text: string) => {
      const cleaned = text.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
      onCodeChange(cleaned);
      if (cleaned.length === CODE_LENGTH) {
        onComplete?.(cleaned);
      }
    },
    [onCodeChange, onComplete]
  );

  const focusHiddenInput = useCallback(() => {
    hiddenInputRef.current?.focus();
  }, []);

  return (
    <View>
      <TextInputComponent
        ref={hiddenInputRef}
        testID={testID}
        style={styles.hiddenInput}
        value={code}
        onChangeText={handleCodeChange}
        keyboardType={Platform.OS === 'ios' && Platform.isPad ? 'decimal-pad' : 'number-pad'}
        maxLength={CODE_LENGTH}
        caretHidden
        autoFocus={autoFocus}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        inputMode="numeric"
      />
      <Pressable style={styles.codeInputContainer} onPress={focusHiddenInput}>
        {Array.from({ length: CODE_LENGTH }).map((_, index) => {
          const digit = code[index] || '';
          const isFilled = digit !== '';
          return (
            <View
              key={index}
              style={[
                styles.codeBox,
                {
                  backgroundColor: isFilled ? colors.cardBackground : colors.inputBackground,
                  borderColor: isFilled ? colors.buttonActive : colors.inputBorder,
                },
              ]}
            >
              <Text size="lg" weight="semibold" color={colors.text}>
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  codeInputContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  codeBox: {
    width: 40,
    height: 48,
    borderRadius: radiusPixels.md,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default OtpCodeInput;
