// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY not found in environment variables');
  process.exit(1);
}

// Language configurations
const languages = {
  en: { name: 'English', voice: 'en-US' },
  es: { name: 'Spanish', voice: 'es-ES' },
  fr: { name: 'French', voice: 'fr-FR' },
  de: { name: 'German', voice: 'de-DE' },
  it: { name: 'Italian', voice: 'it-IT' },
  pt: { name: 'Portuguese', voice: 'pt-BR' },
  ru: { name: 'Russian', voice: 'ru-RU' },
  zh: { name: 'Chinese', voice: 'zh-CN' },
  ja: { name: 'Japanese', voice: 'ja-JP' },
  ko: { name: 'Korean', voice: 'ko-KR' },
  ar: { name: 'Arabic', voice: 'ar-SA' },
  hi: { name: 'Hindi', voice: 'hi-IN' }
};

// In-memory storage for session data (use Redis in production)
const sessions = new Map();

// Utility function to parse CSV file
function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Utility function to generate insights from data
function generateDataInsights(data) {
  if (!data || data.length === 0) return [];

  const insights = [];
  const numericColumns = [];
  const categoricalColumns = [];

  // Analyze column types
  if (data[0]) {
    Object.keys(data[0]).forEach(key => {
      const sampleValues = data.slice(0, 10).map(row => row[key]).filter(val => val !== null && val !== '');
      const numericValues = sampleValues.filter(val => !isNaN(parseFloat(val)));
      
      if (numericValues.length / sampleValues.length > 0.7) {
        numericColumns.push(key);
      } else {
        categoricalColumns.push(key);
      }
    });
  }

  // Generate basic insights
  insights.push({
    type: 'overview',
    title: 'Data Overview',
    content: `Dataset contains ${data.length} records with ${Object.keys(data[0] || {}).length} columns.`
  });

  // Numeric column insights
  numericColumns.forEach(col => {
    const values = data.map(row => parseFloat(row[col])).filter(val => !isNaN(val));
    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const max = Math.max(...values);
      const min = Math.min(...values);
      
      insights.push({
        type: 'numeric',
        title: `${col} Analysis`,
        content: `Average: ${avg.toFixed(2)}, Max: ${max}, Min: ${min}, Total: ${sum.toFixed(2)}`
      });
    }
  });

  // Categorical column insights
  categoricalColumns.forEach(col => {
    const values = data.map(row => row[col]).filter(val => val);
    const uniqueCount = new Set(values).size;
    
    insights.push({
      type: 'categorical',
      title: `${col} Distribution`,
      content: `${uniqueCount} unique values out of ${values.length} records.`
    });
  });

  return insights.slice(0, 5); // Return top 5 insights
}

// Routes
// Add this route BEFORE your existing routes in server.js
// Add this after line 118 (after the sessions = new Map(); line)

// Root route - Add this to fix 404 on localhost:3000
app.get('/', (req, res) => {
    res.json({
      message: 'Narrative AI Backend Server',
      status: 'Running',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        chat: '/api/chat (POST)',
        upload: '/api/upload (POST)',
        analyze: '/api/analyze (POST)',
        languages: '/api/languages'
      },
      documentation: 'Visit /api/health to check server status'
    });
  });
  
  // Add a catch-all for undefined API routes
  app.get('/api/*', (req, res) => {
    res.status(404).json({
      error: 'API endpoint not found',
      availableEndpoints: [
        'GET /api/health',
        'POST /api/chat',
        'POST /api/upload',
        'POST /api/analyze',
        'GET /api/languages'
      ]
    });
  });

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    groqConnected: !!GROQ_API_KEY
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { 
      message, 
      role = 'ceo', 
      language = 'en', 
      conversationHistory = [],
      hasData = false,
      dataContext = ''
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Create system prompt based on role and context
    const rolePrompts = {
      ceo: 'Strategic insights, growth opportunities, ROI analysis, and high-level business decisions',
      marketer: 'Marketing campaigns, conversion rates, customer acquisition, and engagement metrics',
      product: 'Product features, user experience, engagement analytics, and product development',
      analyst: 'Detailed statistical analysis, data trends, correlations, and technical insights'
    };

    const systemPrompt = `You are Narrative AI, a multilingual business analyst. Always respond in ${languages[language]?.name || 'English'}.

Current context:
- User role: ${role.toUpperCase()}
- Language: ${languages[language]?.name || 'English'}
- Data available: ${hasData ? 'Yes' : 'No'}
${dataContext ? `- Data context: ${dataContext}` : ''}

Role focus: ${rolePrompts[role] || rolePrompts.ceo}

Provide clear, actionable insights in the requested language. Be conversational, professional, and focus on business value. If data is available, reference specific metrics and trends.`;

    // Prepare messages for Groq API
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-6), // Keep last 6 messages for context
      { role: 'user', content: message }
    ];

    // Call Groq API
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: messages,
        max_tokens: 1000,
        temperature: 0.7,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API Error:', response.status, errorText);
      throw new Error(`Groq API Error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    res.json({
      response: aiResponse,
      usage: data.usage,
      model: data.model
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message 
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];
    
    for (const file of req.files) {
      try {
        const data = await parseCSVFile(file.path);
        const insights = generateDataInsights(data);
        
        results.push({
          filename: file.originalname,
          recordCount: data.length,
          columns: Object.keys(data[0] || {}),
          data: data.slice(0, 100), // Return first 100 rows for preview
          insights: insights,
          success: true
        });

        // Clean up uploaded file
        fs.unlinkSync(file.path);
        
      } catch (parseError) {
        console.error(`Error parsing ${file.originalname}:`, parseError);
        results.push({
          filename: file.originalname,
          error: parseError.message,
          success: false
        });
      }
    }

    res.json({ results });

  } catch (error) {
    console.error('Upload API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process file upload',
      details: error.message 
    });
  }
});

// Data analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { data, role = 'ceo', language = 'en', analysisType = 'general' } = req.body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'Valid data array is required' });
    }

    // Generate comprehensive data summary
    const columns = Object.keys(data[0] || {});
    const numericColumns = columns.filter(col => {
      const sampleValues = data.slice(0, 10).map(row => parseFloat(row[col])).filter(val => !isNaN(val));
      return sampleValues.length > 5;
    });

    let dataContext = `Dataset: ${data.length} records, ${columns.length} columns (${columns.join(', ')})`;
    
    if (numericColumns.length > 0) {
      const stats = numericColumns.map(col => {
        const values = data.map(row => parseFloat(row[col])).filter(val => !isNaN(val));
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        return `${col}: avg ${avg.toFixed(2)}`;
      }).join(', ');
      dataContext += `. Key metrics: ${stats}`;
    }

    // Create analysis prompt
    const analysisPrompts = {
      general: 'Provide a comprehensive business analysis',
      trends: 'Focus on trends and patterns in the data',
      performance: 'Analyze performance metrics and KPIs',
      insights: 'Extract key insights and recommendations'
    };

    const prompt = `${analysisPrompts[analysisType] || analysisPrompts.general} for this business data: ${dataContext}. 
    Provide actionable insights from a ${role} perspective in ${languages[language]?.name || 'English'}.`;

    // Call chat endpoint internally
    const chatResponse = await fetch(`http://localhost:${PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        role,
        language,
        hasData: true,
        dataContext
      })
    });

    if (!chatResponse.ok) {
      throw new Error('Failed to generate analysis');
    }

    const analysisResult = await chatResponse.json();
    const insights = generateDataInsights(data);

    res.json({
      analysis: analysisResult.response,
      insights: insights,
      stats: {
        recordCount: data.length,
        columnCount: columns.length,
        numericColumns: numericColumns.length,
        columns: columns
      }
    });

  } catch (error) {
    console.error('Analysis API Error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze data',
      details: error.message 
    });
  }
});

// Get supported languages
app.get('/api/languages', (req, res) => {
  res.json({ languages });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Max size is 10MB.' });
    }
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Groq API Key: ${GROQ_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🌍 CORS enabled for local development`);
  
  // Create uploads directory if it doesn't exist
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`📁 Created uploads directory: ${uploadsDir}`);
  }
});