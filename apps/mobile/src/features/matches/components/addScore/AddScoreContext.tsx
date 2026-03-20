/**
 * Add Score Context
 *
 * Context provider for managing state across the Add Score flow.
 * Handles dynamic steps based on match type (singles vs doubles).
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { MatchType, AddScoreFormData, AddScoreStep } from './types';
import { SINGLES_SCORE_STEPS, DOUBLES_SCORE_STEPS } from './types';

interface AddScoreContextType {
  // Form data
  formData: Partial<AddScoreFormData>;
  updateFormData: (data: Partial<AddScoreFormData>) => void;
  resetFormData: () => void;

  // Navigation
  currentStep: AddScoreStep;
  currentStepIndex: number;
  totalSteps: number;
  goToNextStep: () => boolean;
  goToPreviousStep: () => boolean;
  canGoNext: boolean;
  canGoBack: boolean;
  isLastStep: boolean;

  // Match type
  matchType: MatchType | null;
  setMatchType: (type: MatchType) => void;
}

const AddScoreContext = createContext<AddScoreContextType | null>(null);

interface AddScoreProviderProps {
  children: React.ReactNode;
  initialMatchType?: MatchType;
  networkId?: string;
}

const initialFormData: Partial<AddScoreFormData> = {
  opponents: [],
  matchDate: new Date(),
  sport: 'tennis',
  expectation: 'competitive',
  sets: [{ team1Score: null, team2Score: null }],
};

export function AddScoreProvider({ children, initialMatchType, networkId }: AddScoreProviderProps) {
  const [formData, setFormData] = useState<Partial<AddScoreFormData>>({
    ...initialFormData,
    matchType: initialMatchType,
    networkId,
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [matchType, setMatchTypeState] = useState<MatchType | null>(initialMatchType || null);

  // Get the appropriate steps based on match type
  const steps = useMemo(() => {
    return matchType === 'double' ? DOUBLES_SCORE_STEPS : SINGLES_SCORE_STEPS;
  }, [matchType]);

  const currentStep = steps[currentStepIndex];
  const totalSteps = steps.length;
  const isLastStep = currentStepIndex === steps.length - 1;
  const canGoBack = currentStepIndex > 0;
  const canGoNext = currentStepIndex < steps.length - 1;

  const updateFormData = useCallback((data: Partial<AddScoreFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  }, []);

  const resetFormData = useCallback(() => {
    setFormData({
      ...initialFormData,
      networkId,
    });
    setCurrentStepIndex(0);
    setMatchTypeState(null);
  }, [networkId]);

  const setMatchType = useCallback((type: MatchType) => {
    setMatchTypeState(type);
    setFormData(prev => ({ ...prev, matchType: type }));
  }, []);

  const goToNextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
      return true;
    }
    return false;
  }, [currentStepIndex, steps.length]);

  const goToPreviousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
      return true;
    }
    return false;
  }, [currentStepIndex]);

  const value: AddScoreContextType = {
    formData,
    updateFormData,
    resetFormData,
    currentStep,
    currentStepIndex,
    totalSteps,
    goToNextStep,
    goToPreviousStep,
    canGoNext,
    canGoBack,
    isLastStep,
    matchType,
    setMatchType,
  };

  return <AddScoreContext.Provider value={value}>{children}</AddScoreContext.Provider>;
}

export function useAddScore() {
  const context = useContext(AddScoreContext);
  if (!context) {
    throw new Error('useAddScore must be used within an AddScoreProvider');
  }
  return context;
}
