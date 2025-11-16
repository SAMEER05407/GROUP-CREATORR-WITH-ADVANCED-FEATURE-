# WhatsApp Group Creator Pro

## Overview

This is a WhatsApp bot application that enables automated creation and management of WhatsApp groups. The system uses the whatsapp-web.js library to interface with WhatsApp Web, allowing users to create groups, manage members, and perform administrative tasks through a web interface. The application supports multi-user sessions with authentication and includes an admin panel for user management.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Single Page Application (SPA)**
- Pure HTML/CSS/JavaScript implementation without frameworks
- Client-side rendering with dynamic DOM manipulation
- Mobile-responsive design with gradient backgrounds and card-based UI
- Real-time status updates through polling mechanism

**Key Design Decisions:**
- **No Framework Approach**: Chosen for simplicity and minimal dependencies, making the application lightweight and easy to deploy
- **Polling-based Updates**: Uses 5-second intervals to check WhatsApp connection status instead of WebSockets
- **File Upload Handling**: Converts files to base64 for transmission to backend

### Backend Architecture

**Express.js Server**
- Modular route organization separating authentication, WhatsApp operations, and group management
- File-based data persistence for configuration
- Session management using Map data structure for in-memory user sessions
- RESTful API design for client-server communication

**Authentication System:**
- Simple code-based authentication without JWT or session cookies
- Hardcoded admin code (`9209778319`) with additional users stored in `auth_codes.json`
- User ID passed via headers for session identification
- Two-tier access: regular users and admin users with management privileges

**Pros:**
- Simple to implement and understand
- No database dependencies
- Quick authentication without complex token management

**Cons:**
- Not secure for production use (credentials in plain JSON)
- No session expiration or token refresh
- User ID in headers can be easily spoofed

### WhatsApp Integration

**whatsapp-web.js Library**
- Uses LocalAuth strategy for persistent authentication
- Multi-user session support with isolated auth directories per user
- QR code generation for authentication
- Pairing code alternative authentication method

**Session Management:**
- Per-user WhatsApp client instances stored in Map
- Session data stored in `.wwebjs_auth/session-{userId}` directories
- Session cleanup on logout or restart
- Connection state tracking (connected/disconnected/starting)

**Alternatives Considered:**
- Direct WhatsApp Business API: Rejected due to cost and complexity
- Baileys library: whatsapp-web.js chosen for better documentation and stability

### Group Management

**Core Functionality:**
- Bulk group creation with customizable names and descriptions
- Member addition via phone numbers
- Admin promotion capabilities
- Group picture/icon upload support
- Invite link generation for members who cannot be directly added

**Error Handling Strategy:**
- Graceful degradation when members cannot be added
- Automatic invite link fallback
- Status messages for each operation (success/invited/skipped/failed)
- Number validation and WhatsApp registration checks

### Data Persistence

**File-based Storage**
- `auth_codes.json`: Stores authorized user access codes
- `notice.json`: Stores system-wide notice/message
- `.wwebjs_auth/`: Directory containing WhatsApp session data per user

**Rationale:**
- No database setup required
- Simple deployment without external dependencies
- Suitable for small-scale usage
- Easy backup and migration

**Limitations:**
- No concurrent write protection
- Limited scalability
- No query capabilities
- Manual file system management

### API Structure

**Authentication Endpoints:**
- `POST /api/login`: Validates access code and returns admin status

**WhatsApp Management:**
- `GET /api/qr`: Retrieves QR code for WhatsApp authentication
- `GET /api/pairing-code`: Gets pairing code for alternative auth
- `POST /api/use-pairing-code`: Initiates pairing code authentication
- `GET /api/status`: Returns WhatsApp connection status
- `POST /api/restart-whatsapp`: Restarts WhatsApp client session

**Health Check:**
- `GET /`: Basic server status
- `GET /ping`: Simple uptime monitoring endpoint
- `GET /health`: Detailed health status with uptime

### Application Entry Point

**Bootstrap Process:**
- `index.js` serves as minimal entry point
- Delegates to `server/index.js` for Express server initialization
- Modular separation allows for future expansion

## External Dependencies

### Core Dependencies

**whatsapp-web.js (v1.26.0)**
- Purpose: WhatsApp Web API client for automation
- Provides: Message sending, group management, authentication
- Note: Relies on WhatsApp Web's unofficial API, subject to changes

**Express (v4.21.2)**
- Purpose: Web server framework
- Handles: HTTP routing, middleware, static file serving
- Configuration: 50MB JSON payload limit for file uploads

**qrcode (v1.5.1)**
- Purpose: QR code generation for WhatsApp authentication
- Used in: Initial WhatsApp Web login flow

**qrcode-terminal (v0.12.0)**
- Purpose: Display QR codes in terminal for debugging
- Optional: Development/debugging tool

**node-fetch (v3.3.2)**
- Purpose: HTTP client for potential external API calls
- Note: May be used for future integrations

### Third-party Service Integration

**WhatsApp Web Protocol**
- Connection: Browser automation approach via whatsapp-web.js
- Authentication: QR code or pairing code methods
- Limitations: Unofficial API, requires active WhatsApp account
- Rate Limits: Subject to WhatsApp's anti-spam policies

### Monitoring Integration

**UptimeRobot Ready**
- Dedicated `/ping` and `/health` endpoints
- Designed for external monitoring services
- Returns 200 OK status for uptime tracking

### File System Dependencies

- Node.js `fs` module for file operations
- Persistent storage in project directory
- Session data in `.wwebjs_auth/` subdirectory
- No external file storage services