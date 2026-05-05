# Reelday Project Skill

## Stack
- Backend: Node.js + Fastify 4, ES modules
- Frontend: Vanilla HTML/CSS/JS, no framework
- Database: PostgreSQL via pg pool
- Storage: Cloudflare R2 via AWS S3 SDK
- Payments: PayMongo (GCash, Maya, Card)
- Hosting: EasyPanel on Hostinger VPS KVM2
- Port: 3000

## File structure
backend/server.js - main entry
backend/routes/ - health, events, uploads, payments
backend/plugins/ - database.js, storage.js
backend/utils/qr.js - QR generation
frontend/ - index, create, upload, dashboard, wall
frontend/css/style.css - shared theme CSS vars
frontend/images/ - gcash-qr.jpeg

## Brand
Colors: coral #e8735a, plum #3d1f2d, 
        blush #f2a7a0, cream #fdf8f3
Fonts: Playfair Display + DM Sans
Tone: Taglish (English default, Filipino toggle)
Market: Filipino weddings, debuts, birthdays

## Theme system
data-theme attribute on body
Values: wedding, debut, birthday, seventh_birthday,
        baptism, reunion, corporate, memorial
CSS vars: --primary, --accent, --bg, --heading-font

## API patterns
All routes: /api/[resource]/[action]
Error format: { error: 'message', statusCode: 400 }
Success format: { data, message }
Auth: none yet (coming soon)

## Database
events, uploads, video_messages, payments tables
Always use parameterized queries ($1, $2...)
UUID primary keys

## Deployment
GitHub → EasyPanel auto-deploy on push to main
Environment vars in EasyPanel dashboard
Internal DB host: ollama_embeddings_reelday-db

## Important
- Always ES modules (import/export)
- Always async/await
- Mobile-first CSS
- Test GCash payment: gcash-qr.jpeg already exists
- PayMongo keys in .env
