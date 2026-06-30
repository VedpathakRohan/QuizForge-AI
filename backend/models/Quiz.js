import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Mongoose Schema representing an individual multiple-choice question.
 * Enforces exactly 4 response choices, a valid answer index, and explanatory details.
 */
const QuestionSchema = new Schema({
  questionText: {
    type: String,
    required: [true, 'Question text is required.'],
    trim: true
  },
  options: {
    type: [String],
    required: [true, 'An array of options is required.'],
    validate: {
      validator: function (val) {
        return Array.isArray(val) && val.length === 4;
      },
      message: 'The options array must contain exactly 4 response options.'
    }
  },
  correctAnswerIndex: {
    type: Number,
    required: [true, 'Correct answer index is required.'],
    min: [0, 'Correct answer index cannot be less than 0.'],
    max: [3, 'Correct answer index cannot be greater than 3.']
  },
  explanation: {
    type: String,
    required: [true, 'Academic explanation context is required.'],
    trim: true
  }
});

/**
 * Main Quiz Schema mapping generated topics and difficulty levels to arrays of questions.
 */
const QuizSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Quiz title is required.'],
      trim: true
    },
    topic: {
      type: String,
      required: [true, 'Quiz topic is required.'],
      trim: true,
      index: true
    },
    difficulty: {
      type: String,
      required: [true, 'Quiz difficulty level is required.'],
      enum: {
        values: ['easy', 'medium', 'hard'],
        message: '{VALUE} is not a valid difficulty level.'
      },
      trim: true
    },
    questions: {
      type: [QuestionSchema],
      required: [true, 'A quiz must contain questions.'],
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'A quiz must contain at least one question.'
      }
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true
    }
  },
  {
    timestamps: true
  }
);

const Quiz = model('Quiz', QuizSchema);

export default Quiz;
