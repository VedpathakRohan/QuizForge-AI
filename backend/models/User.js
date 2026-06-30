import mongoose from 'mongoose';
import crypto from 'crypto';

const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required.']
    },
    salt: {
      type: String,
      required: [true, 'Salt is required.']
    },
    sessionToken: {
      type: String,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Method to hash password
UserSchema.statics.hashPassword = function (password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
};

// Method to verify password
UserSchema.methods.verifyPassword = function (password) {
  const hash = crypto.pbkdf2Sync(password, this.salt, 1000, 64, 'sha512').toString('hex');
  return this.passwordHash === hash;
};

const User = model('User', UserSchema);

export default User;
