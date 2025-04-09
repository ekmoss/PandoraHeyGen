// AudioWorklet processor for muting audio
class MuteProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.isMuted = true;
      this.port.onmessage = (event) => {
        if (event.data.muted !== undefined) {
          this.isMuted = event.data.muted;
        }
      };
    }
  
    process(inputs, outputs) {
      // If muted, don't copy any input data
      if (this.isMuted) {
        // Return silence
        return true;
      }
      
      // If not muted, pass through the audio
      const input = inputs[0];
      const output = outputs[0];
      
      for (let channel = 0; channel < input.length; ++channel) {
        const inputChannel = input[channel];
        const outputChannel = output[channel];
        for (let i = 0; i < inputChannel.length; ++i) {
          outputChannel[i] = inputChannel[i];
        }
      }
      
      return true;
    }
  }
  
  registerProcessor('mute-processor', MuteProcessor);