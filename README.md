# Pandora - Customized HeyGen Interactive Avatar

![Pandora Interactive Avatar](./public/demo.png)

Pandora is a customized version of the HeyGen Interactive Avatar demo, tailored specifically for Capgemini's trade show experience. The application provides an interactive AI avatar that can respond to voice or text input through a user-friendly interface optimized for touch screens in portrait mode.

## Features

- **Full-screen Portrait Mode**: Designed for large touchscreen displays
- **Push-to-Talk Interface**: Simple tap-to-toggle microphone control
- **Auto-configuration**: Avatar settings are loaded from environment variables
- **Capgemini Branding**: Uses Capgemini AUNZ colors and design language
- **Admin Panel**: Hidden configuration panel accessible by typing "admin" (Incomplete)
- **Voice Activity Detection**: Efficient audio processing to detect when a user is speaking (Experimental)
- **Performance Optimization**: Low-latency responses with detailed metrics tracking (Incomplete)
- **RAG Capability**: Retrieval Augmented Generation for knowledge-based responses (Incomplete)

## Project Structure

The project follows a Next.js application structure with the following key directories:

- **app/**: Main application directory using Next.js App Router structure
- **components/**: Reusable React components for avatar and UI elements
- **public/**: Static assets for the website, including background images and logos
- **services/**: Service implementations for external APIs like audio recording and OpenAI
- **styles/**: CSS and styling files using Tailwind CSS
- **documentation/**: Centralized location for all project documentation files

### Key Components

- **InteractiveAvatar.tsx**: Main component that implements a streaming HeyGen avatar with optimized audio capture and processing
- **StreamingVoiceTest.tsx**: Component for testing voice streaming functionality with performance metrics
- **openai-service.ts**: Service that centralizes all OpenAI API interactions, including RAG functionality

### API Routes

The application uses several API routes for different functions:

- **/api/chat**: Generates chat responses using Azure OpenAI
- **/api/transcribe**: Transcribes audio files to text using Azure's OpenAI Whisper model
- **/api/get-access-token**: Obtains HeyGen API tokens for the StreamingAvatar component
- **/api/speech-token**: Obtains Azure speech service tokens for speech-to-text functionality

## Environment Setup

Configuration is managed through environment variables in the `.env` file:

```
# HeyGen Configuration
HEYGEN_API_KEY=your_api_key_here
NEXT_PUBLIC_DEFAULT_AVATAR_ID=avatar_id_here

# Azure OpenAI Configuration
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_ID=your_deployment_id
AZURE_OPENAI_API_VERSION=2023-05-15

# Azure Speech Services
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_azure_region

# Application Settings
NEXT_PUBLIC_DEFAULT_LANGUAGE=en-US
NEXT_PUBLIC_AVATAR_NAME=Maya
NEXT_PUBLIC_AVATAR_TAGLINE=The Capgemini AUNZ Assistant
```

## Getting Started

1. Clone this repository

   ```bash
   git clone https://github.com/your-username/pandora-heygen.git
   cd pandora-heygen
   ```

2. Install dependencies

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the required environment variables (see above)

4. Run the development server

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Development Guidelines

### Using the OpenAI Service

The application uses a centralized OpenAI service for all AI interactions. To use it in a component:

```typescript
import { processUserMessage, parseJsonResponse } from "services/openai-service";

// For standard chat
const response = await processUserMessage(userInput);
const result = await parseJsonResponse(response);

// For RAG-enhanced responses
const response = await processUserMessage(userInput, { useRAG: true });
const result = await parseJsonResponse(response);
```

### Testing Voice Functionality

The application includes dedicated test pages for voice functionality:

- **/test-voice**: Basic voice testing without streaming (Depreciated)
- **/test-streaming**: Advanced streaming voice test with performance metrics

### Admin Access

To access the admin configuration panel at any time:

1. Type "admin" on your keyboard
2. Enter the access code: "capgemini123" (configurable)
3. Adjust settings as needed
4. Click "Start With Custom Settings" to begin a session with these settings

## Trade Show Usage Guidelines

For the best trade show experience:

- Ensure the device is in portrait orientation
- Use a device with a responsive touchscreen
- Test microphone functionality before the event
- Ensure internet connectivity is stable
- Keep the avatar at "High" quality setting for best visual appearance

## Troubleshooting

### StreamingAvatar Issues

The application uses two separate token systems:

- HeyGen API tokens from `/api/get-access-token` (required for StreamingAvatar)
- Azure Speech tokens from `/api/speech-token` (for speech-to-text)

Common WebRTC issues with the StreamingAvatar component:

- "Unknown DataChannel error": Often related to network configuration or firewall issues
- "Stream disconnected": Connection to HeyGen servers was lost

Check the browser console for detailed error messages and ensure your network allows WebRTC traffic.

## Original HeyGen Documentation

### Which Avatars can I use with this project?

By default, there are several Public Avatars that can be used in Interactive Avatar. (AKA Interactive Avatars.) You can find the Avatar IDs for these Public Avatars by navigating to [app.heygen.com/interactive-avatar](https://app.heygen.com/interactive-avatar) and clicking 'Select Avatar' and copying the avatar id.

In order to use a private Avatar created under your own account in Interactive Avatar, it must be upgraded to be a Interactive Avatar. Only 1. Finetune Instant Avatars and 2. Studio Avatars are able to be upgraded to Interactive Avatars. This upgrade is a one-time fee and can be purchased by navigating to [app.heygen.com/interactive-avatar] and clicking 'Select Avatar'.

Please note that Photo Avatars are not compatible with Interactive Avatar and cannot be used.

### Where can I read more about enterprise-level usage of the Interactive Avatar API?

Please read our Interactive Avatar 101 article for more information on pricing and how to increase your concurrent session limit: https://help.heygen.com/en/articles/9182113-interactive-avatar-101-your-ultimate-guide

## Additional Documentation

For more detailed information about the project structure, implementation details, and architectural decisions, see the documentation files in the `/documentation` directory:

- **project_overview.txt**: Comprehensive overview of the project structure and components
- **latency-optimization-log.txt**: Documentation of performance optimization efforts
- **streaming-audio-implementation-plan.txt**: Details about the streaming audio implementation
