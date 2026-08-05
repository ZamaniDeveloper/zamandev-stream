/* webrtc-helper.js - Advanced WebRTC Connection and Low Bandwidth Optimization Engine */

class WebRTCHelper {
  // Connection profiles defining bandwidth and quality parameters
  static PROFILES = {
    high: {
      label: 'کیفیت بالا (High - 720p)',
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: true,
      videoBitrate: 1200, // kbps
      audioBitrate: 64, // kbps
      icon: 'fa-signal'
    },
    medium: {
      label: 'کیفیت متوسط (Medium - 480p)',
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
      audio: true,
      videoBitrate: 400, // kbps
      audioBitrate: 40, // kbps
      icon: 'fa-chart-bar'
    },
    low: {
      label: 'کیفیت اقتصادی (Low - 240p - اینترنت ضعیف)',
      video: {
        width: { max: 320, ideal: 320 },
        height: { max: 240, ideal: 240 },
        frameRate: { max: 15, ideal: 12 }
      },
      audio: true,
      videoBitrate: 100, // kbps (extremely light!)
      audioBitrate: 20, // kbps (optimized audio)
      icon: 'fa-exclamation-triangle'
    },
    audio: {
      label: 'فقط صدا (Audio-Only - فوق اقتصادی)',
      video: false,
      audio: true,
      videoBitrate: 0,
      audioBitrate: 16, // kbps (highly compressed Opus)
      icon: 'fa-microphone'
    }
  };

  // Public STUN servers. Add your own authenticated TURN service for production.
  static ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  /**
   * Acquire media stream with given quality profile constraints
   * @param {string} profileName - 'high' | 'medium' | 'low' | 'audio'
   * @returns {Promise<MediaStream>}
   */
  static async getUserMedia(profileName = 'medium', facingMode = 'user') {
    const profile = this.PROFILES[profileName] || this.PROFILES.medium;
    console.log(`[Media] Requesting getUserMedia with profile: ${profileName}, facingMode: ${facingMode}`, profile);
    
    // Set up standard audio constraints prioritizing echo cancellation and noise suppression
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    if (profileName === 'audio') {
      return await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints
      });
    }

    // Build final constraints with facingMode
    const videoConstraints = profile.video ? { ...profile.video } : {};
    if (facingMode) {
      videoConstraints.facingMode = facingMode;
    }

    const constraints = {
      video: videoConstraints,
      audio: audioConstraints
    };

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn(`[Media] Failed to get stream with profile "${profileName}" and facingMode "${facingMode}". Falling back to Low...`, err);
      // Fallback to low quality if medium/high fails
      if (profileName !== 'low') {
        return await this.getUserMedia('low', facingMode);
      }
      throw err;
    }
  }

  /**
   * Modifies an SDP (Session Description Protocol) string to inject strict bandwidth limits.
   * This forces Chrome/Firefox/Safari to respect our bitrate limits and prevents packet loss on weak networks.
   * @param {string} sdp - The original WebRTC SDP string.
   * @param {number} videoBitrate - Max video bitrate in kbps.
   * @param {number} audioBitrate - Max audio bitrate in kbps.
   * @returns {string} The modified SDP.
   */
  static applyBandwidthLimits(sdp, videoBitrate, audioBitrate) {
    let sdpLines = sdp.split('\r\n');
    let modifiedSdp = [];
    let currentMediaSection = null; // 'audio' or 'video'

    for (let i = 0; i < sdpLines.length; i++) {
      let line = sdpLines[i];
      modifiedSdp.push(line);

      // Track if we enter a media section
      if (line.startsWith('m=audio')) {
        currentMediaSection = 'audio';
      } else if (line.startsWith('m=video')) {
        currentMediaSection = 'video';
      } else if (line.startsWith('m=')) {
        currentMediaSection = null;
      }

      // If we are at the end of the m= lines or setup configuration, insert b=AS limit
      // We look for a typical end-of-description indicator or we can append it directly after the m= line
      if (line.startsWith('m=audio') && audioBitrate > 0) {
        // Enforce max audio bandwidth
        modifiedSdp.push(`b=AS:${audioBitrate}`);
      } else if (line.startsWith('m=video') && videoBitrate > 0) {
        // Enforce max video bandwidth
        modifiedSdp.push(`b=AS:${videoBitrate}`);
      }

      // Add Opus Forward Error Correction (FEC) flag for resilient audio on bad connections
      if (line.includes('a=rtpmap:') && line.includes('opus/48000') && currentMediaSection === 'audio') {
        // Opus lines might have a format description we can append parameters to
        // Format of line: a=rtpmap:111 opus/48000/2
        const payloadType = line.split(':')[1].split(' ')[0];
        
        // Find the corresponding format parameter line 'a=fmtp:<pt>'
        let foundFmtp = false;
        for (let j = i + 1; j < sdpLines.length; j++) {
          if (sdpLines[j].startsWith(`a=fmtp:${payloadType}`)) {
            // Append useinbandfec=1 to enable advanced Opus audio error correction
            if (!sdpLines[j].includes('useinbandfec=1')) {
              sdpLines[j] += ';useinbandfec=1;maxaveragebitrate=' + (audioBitrate * 1000);
            }
            foundFmtp = true;
            break;
          }
        }
        // If fmtp doesn't exist, create one
        if (!foundFmtp) {
          modifiedSdp.push(`a=fmtp:${payloadType} useinbandfec=1;maxaveragebitrate=${audioBitrate * 1000}`);
        }
      }
    }

    return modifiedSdp.join('\r\n');
  }

  /**
   * Monitor peer connection stats and report packet loss, rtt, bitrate
   * @param {RTCPeerConnection} peerConnection 
   * @param {function} onStatsUpdate - callback receiving a stats report object
   * @returns {number} intervalId - can be used to stop monitoring
   */
  static monitorStats(peerConnection, onStatsUpdate) {
    let lastBytesReceived = 0;
    let lastBytesSent = 0;
    let lastPacketsReceived = 0;
    let lastPacketsLost = 0;
    let lastTime = performance.now();

    const intervalId = setInterval(async () => {
      if (peerConnection.signalingState === 'closed') {
        clearInterval(intervalId);
        return;
      }

      try {
        const statsReport = await peerConnection.getStats();
        const now = performance.now();
        const timeDeltaSeconds = (now - lastTime) / 1000;
        lastTime = now;

        let stats = {
          latency: 0, // RTT in ms
          downloadSpeed: 0, // kbps
          uploadSpeed: 0, // kbps
          packetLoss: 0, // %
          videoResolution: 'N/A',
          fps: 0,
          qualityStatus: 'good' // 'good' | 'medium' | 'poor'
        };

        statsReport.forEach(report => {
          // 1. Latency / RTT from candidate pair
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined) {
              stats.latency = Math.round(report.currentRoundTripTime * 1000);
            }
          }

          // 2. Video parameters & Packets/Bytes from Inbound-RTP (Downloading streams)
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.frameWidth && report.frameHeight) {
              stats.videoResolution = `${report.frameWidth}x${report.frameHeight}`;
            }
            if (report.framesPerSecond) {
              stats.fps = Math.round(report.framesPerSecond);
            }

            // Calculate download speed
            const bytes = report.bytesReceived || 0;
            const bytesDelta = bytes - lastBytesReceived;
            lastBytesReceived = bytes;
            stats.downloadSpeed = Math.round(((bytesDelta * 8) / 1000) / timeDeltaSeconds);

            // Calculate packet loss
            const packetsLost = report.packetsLost || 0;
            const packetsReceived = report.packetsReceived || 0;
            
            const packetsLostDelta = packetsLost - lastPacketsLost;
            const packetsReceivedDelta = packetsReceived - lastPacketsReceived;
            
            lastPacketsLost = packetsLost;
            lastPacketsReceived = packetsReceived;

            const totalPacketsDelta = packetsLostDelta + packetsReceivedDelta;
            if (totalPacketsDelta > 0) {
              stats.packetLoss = Math.round((packetsLostDelta / totalPacketsDelta) * 100);
            }
          }

          // 3. Bytes from Outbound-RTP (Uploading streams)
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            const bytes = report.bytesSent || 0;
            const bytesDelta = bytes - lastBytesSent;
            lastBytesSent = bytes;
            stats.uploadSpeed = Math.round(((bytesDelta * 8) / 1000) / timeDeltaSeconds);
          }
        });

        // Evaluate overall quality status based on latency & packet loss
        if (stats.packetLoss > 8 || stats.latency > 500) {
          stats.qualityStatus = 'poor';
        } else if (stats.packetLoss > 3 || stats.latency > 250) {
          stats.qualityStatus = 'medium';
        } else {
          stats.qualityStatus = 'good';
        }

        onStatsUpdate(stats);
      } catch (err) {
        console.error('[Stats] Error getting RTC stats:', err);
      }
    }, 2500);

    return intervalId;
  }
}

// Export for usage in window object on frontend
window.WebRTCHelper = WebRTCHelper;
