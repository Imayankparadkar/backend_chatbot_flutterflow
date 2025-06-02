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

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY not found in environment variables');
  process.exit(1);
}

// CORS Configuration - SIMPLIFIED AND MORE PERMISSIVE
const allowedOrigins = [
  'https://frontend-chatbot-flutterflow.vercel.app',
  'https://frontend-chatbot-flutterflow-git-main-yourverceluser.vercel.app', // Replace with your actual Vercel user
  'https://frontend-chatbot-flutterflow-git-main.vercel.app',
  'https://frontend-chatbot-flutterflow.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

// Add custom frontend URL if provided
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

console.log('🌍 Allowed CORS Origins:', allowedOrigins);

// CORS Configuration - More permissive for debugging
app.use(cors({
  origin: function (origin, callback) {
    console.log('🔍 Request origin:', origin || 'no-origin');
    
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      console.log('✅ Allowing request with no origin');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list or matches pattern
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      return origin === allowedOrigin || 
             origin.includes('vercel.app') || 
             origin.includes('localhost');
    });
    
    if (isAllowed) {
      console.log('✅ CORS allowing origin:', origin);
      callback(null, true);
    } else {
      console.log('❌ CORS rejecting origin:', origin);
      console.log('🔍 Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Length', 'X-Kuma-Revision'],
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Add explicit preflight handling
app.options('*', (req, res) => {
  console.log('🔄 Preflight request from:', req.headers.origin);
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Basic middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// In-memory storage for session data
const sessions = new Map();

// Utility functions
function parseCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

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

  return insights.slice(0, 5);
}

// ============ API ROUTES ============

// Health check route with detailed logging
app.get('/api/health', (req, res) => {
  try {
    const origin = req.headers.origin || req.headers.referer || 'unknown';
    console.log('🏥 Health check requested from:', origin);
    console.log('🔍 Request headers:', JSON.stringify(req.headers, null, 2));
    
    const healthResponse = { 
      status: 'OK', 
      message: 'Server is running',
      groqConnected: !!GROQ_API_KEY,
      timestamp: new Date().toISOString(),
      origin: origin,
      cors: 'enabled',
      server: 'Render',
      version: '1.0.0'
    };

    console.log('✅ Sending health response:', healthResponse);
    
    // Set CORS headers explicitly
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    
    res.status(200).json(healthResponse);
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    console.log('💬 Chat request received from:', req.headers.origin);
    
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
      ...conversationHistory.slice(-6),
      { role: 'user', content: message }
    ];

    console.log('🚀 Calling Groq API...');

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
      console.error('❌ Groq API Error:', response.status, errorText);
      throw new Error(`Groq API Error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('✅ Chat response generated successfully');

    res.json({
      response: aiResponse,
      usage: data.usage,
      model: data.model
    });

  } catch (error) {
    console.error('❌ Chat API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message 
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    console.log('📁 File upload request from:', req.headers.origin);
    
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
          data: data.slice(0, 100),
          insights: insights,
          success: true
        });

        // Clean up uploaded file
        fs.unlinkSync(file.path);
        
      } catch (parseError) {
        console.error(`❌ Error parsing ${file.originalname}:`, parseError);
        results.push({
          filename: file.originalname,
          error: parseError.message,
          success: false
        });
      }
    }

    console.log('✅ File upload processed successfully');
    res.json({ results });

  } catch (error) {
    console.error('❌ Upload API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process file upload',
      details: error.message 
    });
  }
});

// Data analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    console.log('📊 Analysis request from:', req.headers.origin);
    
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
    const baseURL = `http://localhost:${PORT}`;

    const chatResponse = await fetch(`${baseURL}/api/chat`, {
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

    console.log('✅ Analysis completed successfully');

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
    console.error('❌ Analysis API Error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze data',
      details: error.message 
    });
  }
});

// Get supported languages
app.get('/api/languages', (req, res) => {
  console.log('🌐 Languages request from:', req.headers.origin);
  res.json({ languages });
});

// ============ STATIC FILES & CATCH-ALL ============

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({
      message: 'Narrative AI Server Running',
      status: 'OK',
      timestamp: new Date().toISOString(),
      availableEndpoints: [
        'GET /api/health',
        'POST /api/chat',
        'POST /api/upload',
        'POST /api/analyze',
        'GET /api/languages'
      ]
    });
  }
});

// Catch-all for undefined API routes
app.all('/api/*', (req, res) => {
  console.log('❓ Unknown API route requested:', req.method, req.path);
  res.status(404).json({
    error: 'API endpoint not found',
    method: req.method,
    path: req.path,
    availableEndpoints: [
      'GET /api/health',
      'POST /api/chat',
      'POST /api/upload',
      'POST /api/analyze',
      'GET /api/languages'
    ]
  });
});

// Catch-all for any other routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({
      error: 'Page not found',
      message: 'No static files found. Make sure your public directory contains index.html',
      path: req.path
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  
  // CORS error handling
  if (err.message === 'Not allowed by CORS') {
    console.log('🚫 CORS Error - Origin:', req.headers.origin);
    console.log('🔍 Allowed Origins:', allowedOrigins);
    return res.status(403).json({ 
      error: 'CORS policy violation',
      origin: req.headers.origin,
      allowedOrigins: allowedOrigins
    });
  }
  
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🚀 Server also accessible on http://0.0.0.0:${PORT}`);
  console.log(`📊 Groq API Key: ${GROQ_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🌍 CORS Origins:`, allowedOrigins);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Create directories
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`📁 Created uploads directory: ${uploadsDir}`);
  }

  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log(`📁 Created public directory: ${publicDir}`);
  }

  console.log('🎯 Server is ready to accept connections!');
});