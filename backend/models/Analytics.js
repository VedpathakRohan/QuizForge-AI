import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Analytics Schema to track and audit student execution metrics.
 * Persists scores, timestamps, accuracy levels, and tab-switch violation counters.
 */
const AnalyticsSchema = new Schema(
  {
    quizId: {
      type: Schema.Types.ObjectId,
      ref: 'Quiz',
      required: [true, 'Reference to the source Quiz ID is required.'],
      index: true
    },
    finalScore: {
      type: Number,
      required: [true, 'Final score is required.'],
      min: [0, 'Final score cannot be less than 0.']
    },
    totalQuestions: {
      type: Number,
      required: [true, 'Total questions count is required.'],
      min: [1, 'Total questions must be at least 1.']
    },
    userAccuracy: {
      type: Number,
      required: [true, 'User accuracy percentage is required.'],
      min: [0, 'User accuracy percentage cannot be less than 0.'],
      max: [100, 'User accuracy percentage cannot exceed 100.']
    },
    timeSpentSeconds: {
      type: Number,
      required: [true, 'Time spent in seconds is required.'],
      min: [0, 'Time spent cannot be negative.']
    },
    antiCheatViolations: {
      type: Number,
      required: [true, 'Anti-cheat violations count is required.'],
      min: [0, 'Anti-cheat violations cannot be negative.'],
      default: 0
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

const Analytics = model('Analytics', AnalyticsSchema);

export default Analytics;
