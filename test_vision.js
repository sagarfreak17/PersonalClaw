import screenshot from 'screenshot-desktop';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function testVision() {
  const finalPath = path.join(process.cwd(), `test_screen_${Date.now()}.png`);
  try {
    console.log(`[Test] Capturing screenshot...`);
    await screenshot({ filename: finalPath });
    console.log(`[Test] Screenshot saved to: ${finalPath}`);

    if (!fs.existsSync(finalPath)) {
      throw new Error('Screenshot file not created');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const imageData = fs.readFileSync(finalPath);
    
    console.log(`[Test] Sending to Gemini...`);
    const result = await model.generateContent([
      "What is visible on this screen? Summarize the open windows.",
      {
        inlineData: {
          data: Buffer.from(imageData).toString('base64'),
          mimeType: 'image/png',
        },
      },
    ]);

    const response = await result.response;
    console.log(`[Test] Gemini Response:`, response.text());
  } catch (error) {
    console.error(`[Test] Error:`, error);
  } finally {
    if (fs.existsSync(finalPath)) {
      // fs.unlinkSync(finalPath); // Keep for a moment to verify manually if needed
      console.log(`[Test] Preserving screenshot for verification: ${finalPath}`);
    }
  }
}

testVision();
