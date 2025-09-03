#!/usr/bin/env node

// Example: Test Enhanced Crawler
import { runEnhancedCrawler } from '../enhanced-crawler.mjs';
import path from 'path';

const examples = [
  {
    name: 'GitHub Homepage',
    url: 'https://github.com',
    options: {
      maxDepth: 2,
      maxInteractions: 5,
      suggest: true,
      waitMs: 3000
    }
  },
  {
    name: 'Simple Test Site',
    url: 'https://example.com',
    options: {
      maxDepth: 1,
      maxInteractions: 3,
      suggest: true
    }
  }
];

async function runExamples() {
  console.log('🚀 Testing Enhanced Crawler\n');
  
  for (const example of examples) {
    console.log(`📋 Testing: ${example.name}`);
    console.log(`🔗 URL: ${example.url}`);
    
    const outputFile = path.join(process.cwd(), 'snapshots', 
      `${example.name.toLowerCase().replace(/\s+/g, '-')}-enhanced.json`);
    
    try {
      const startTime = Date.now();
      const result = await runEnhancedCrawler(example.url, outputFile, example.options);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Success! (${duration}ms)`);
      console.log(`   📊 States: ${result.states.length}`);
      console.log(`   🎯 Elements: ${result.crawlMetadata.totalElements}`);
      console.log(`   🔍 Max Depth: ${result.crawlMetadata.maxDepthReached}`);
      console.log(`   📁 Output: ${outputFile}\n`);
      
    } catch (error) {
      console.log(`❌ Failed: ${error.message}\n`);
    }
  }
  
  console.log('🎉 Enhanced crawler testing complete!');
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runExamples().catch(console.error);
}

export { runExamples };
