const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a simple 32x32 PNG favicon
const size = 32;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Draw a simple camera icon (brown circle with lighter circle inside)
ctx.fillStyle = '#3e2a20'; // rgb(62,42,32)
ctx.beginPath();
ctx.arc(16, 16, 14, 0, Math.PI * 2);
ctx.fill();

// Inner circle
ctx.fillStyle = '#f5ddcb'; // rgb(245,221,203)
ctx.beginPath();
ctx.arc(16, 16, 8, 0, Math.PI * 2);
ctx.fill();

// Small dot in center
ctx.fillStyle = '#3e2a20';
ctx.beginPath();
ctx.arc(16, 16, 3, 0, Math.PI * 2);
ctx.fill();

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('favicon.png', buffer);
fs.writeFileSync('frontend/favicon.png', buffer);

console.log('PNG favicon created successfully!');
