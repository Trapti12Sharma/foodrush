const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in the environment');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri);

  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });
}

module.exports = connectDB;
