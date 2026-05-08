const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  github: {
    id: { type: String, required: true, unique: true },
    username: { type: String },
    name: { type: String },
    avatar: { type: String },
    accessToken: { type: String }, // Encrypted OAuth token
    refreshToken: { type: String }
  },
  vercel: {
    token: { type: String }, // Encrypted Vercel token
    teamId: { type: String }
  },
  projects: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

UserSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('User', UserSchema);