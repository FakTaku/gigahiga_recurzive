#!/usr/bin/env node

// Example: Gmail Enhanced Crawling with Authentication
import { runUnifiedCrawler } from '../unified-crawler.mjs';
import path from 'path';
import fs from 'fs';

async function crawlGmail() {
  console.log('📧 Gmail Enhanced Crawling Example\n');
  
  const authPath = path.join(process.cwd(), '.auth', 'gmail.json');
  const outputPath = path.join(process.cwd(), 'snapshots', 'gmail-enhanced.json');
  
  // Ensure auth directory exists
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  
  const options = {
    mode: 'enhanced',
    headed: !fs.existsSync(authPath), // Use headed mode if no auth saved
    authPath,
    waitMs: 5000, // Gmail needs more time to load
    maxDepth: 2,
    maxInteractions: 8,
    suggest: true,
    enableStateCrawling: true,
    enableInteractionSimulation: true
  };
  
  console.log('⚙️  Configuration:');
  console.log(`   🔐 Auth file: ${authPath} ${fs.existsSync(authPath) ? '(exists)' : '(will be created)'}`);
  console.log(`   👁️  Headed mode: ${options.headed}`);
  console.log(`   🔍 Max depth: ${options.maxDepth}`);
  console.log(`   🎯 Max interactions: ${options.maxInteractions}`);
  console.log('');
  
  if (options.headed) {
    console.log('🔑 Browser will open - please log in to Gmail manually');
    console.log('   The session will be saved for future headless runs');
    console.log('');
  }
  
  try {
    console.log('🚀 Starting Gmail crawl...');
    const startTime = Date.now();
    
    const result = await runUnifiedCrawler('https://mail.google.com', outputPath, options);
    
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ Gmail crawl completed! (${Math.round(duration / 1000)}s)`);
    console.log('');
    console.log('📊 Results:');
    
    if (result.states) {
      console.log(`   📱 States discovered: ${result.states.length}`);
      console.log(`   🎯 Total elements: ${result.crawlMetadata.totalElements}`);
      console.log(`   🔍 Max depth reached: ${result.crawlMetadata.maxDepthReached}`);
      
      // Show some interesting findings
      const allElements = result.states.flatMap(s => s.elements);
      const composeElements = allElements.filter(el => 
        el.labels?.primary?.toLowerCase().includes('compose') ||
        el.labels?.primary?.toLowerCase().includes('write')
      );
      const searchElements = allElements.filter(el => 
        el.labels?.primary?.toLowerCase().includes('search') ||
        el.role === 'searchbox'
      );
      
      console.log(`   ✉️  Compose elements: ${composeElements.length}`);
      console.log(`   🔍 Search elements: ${searchElements.length}`);
      
      // Show discovered shortcuts
      const allShortcuts = result.states.flatMap(s => s.shortcuts || []);
      const verifiedShortcuts = allShortcuts.filter(s => s.verified);
      console.log(`   ⌨️  Verified shortcuts: ${verifiedShortcuts.length}`);
      
      if (verifiedShortcuts.length > 0) {
        console.log('   🔑 Shortcuts found:');
        verifiedShortcuts.slice(0, 5).forEach(shortcut => {
          console.log(`      "${shortcut.key}" - ${shortcut.description}`);
        });
      }
    }
    
    console.log(`   📁 Snapshot saved: ${outputPath}`);
    
    // Check for suggestions
    const suggestionsPath = outputPath.replace('.json', '_enhanced_suggestions.json');
    if (fs.existsSync(suggestionsPath)) {
      const suggestions = JSON.parse(fs.readFileSync(suggestionsPath, 'utf8'));
      console.log(`   🤖 AI suggestions: ${suggestions.suggestions?.length || 0}`);
      console.log(`   📁 Suggestions saved: ${suggestionsPath}`);
    }
    
    console.log('');
    console.log('🎉 Gmail analysis complete!');
    
    if (options.headed && fs.existsSync(authPath)) {
      console.log('💡 Tip: Next time you can run headless since auth is saved');
      console.log(`   Example: node gmail-example.mjs --headless`);
    }
    
  } catch (error) {
    console.error('❌ Gmail crawl failed:', error.message);
    
    if (error.message.includes('authentication') || error.message.includes('login')) {
      console.log('');
      console.log('💡 Authentication help:');
      console.log('   1. Make sure you run with --headed for first-time login');
      console.log('   2. Log in manually when browser opens');
      console.log('   3. Session will be saved for future runs');
    }
  }
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    console.log('Gmail Enhanced Crawling Example');
    console.log('');
    console.log('Usage:');
    console.log('  node gmail-example.mjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --headless    Force headless mode (requires existing auth)');
    console.log('  --headed      Force headed mode (for manual login)');
    console.log('  --help        Show this help');
    console.log('');
    console.log('Examples:');
    console.log('  node gmail-example.mjs                 # Auto-detect auth state');
    console.log('  node gmail-example.mjs --headed        # Manual login');
    console.log('  node gmail-example.mjs --headless      # Use saved auth');
    return;
  }
  
  await crawlGmail();
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}

export { crawlGmail };
