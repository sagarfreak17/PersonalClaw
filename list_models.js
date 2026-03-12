import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function listModels() {
  try {
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await result.json();
    if (data.models) {
      data.models.forEach(m => console.log(m.name));
    } else {
      console.log('No models found:', data);
    }
  } catch (error) {
    console.error(error);
  }
}

listModels();
