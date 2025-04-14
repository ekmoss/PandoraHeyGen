/**
 * This is a placeholder script for audio testing.
 * This file exists to prevent 404 errors seen in the console.
 */

console.log('Test microphone script loaded successfully');

// Simple utility function for microphone testing
function testMicrophone() {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      reject(new Error('Browser does not support getUserMedia API'));
      return;
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        // Success - microphone access granted
        const tracks = stream.getAudioTracks();
        const result = {
          success: true,
          deviceId: tracks[0].getSettings().deviceId,
          label: tracks[0].label,
          constraints: tracks[0].getConstraints()
        };
        
        // Release the stream immediately
        tracks.forEach(track => track.stop());
        
        resolve(result);
      })
      .catch(err => {
        reject({
          success: false,
          error: err.message || 'Unknown error accessing microphone'
        });
      });
  });
}

// Export functionality if this is used as a module
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { testMicrophone };
} 