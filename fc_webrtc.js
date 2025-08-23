window.familyChat = window.familyChat || {};

(function() {
    familyChat.webrtc = {
        peerConnection: null,
        localStream: null,
        isCalling: false,
        isInCall: false,

        init: function() {
            this.setupEventListeners();
        },

        setupEventListeners: function() {
            document.addEventListener('click', (e) => {
                if (e.target.id === 'fc_startCall') {
                    this.startCall();
                } else if (e.target.id === 'fc_endCall') {
                    this.endCall();
                } else if (e.target.id === 'fc_acceptCall') {
                    this.acceptCall();
                } else if (e.target.id === 'fc_rejectCall') {
                    this.rejectCall();
                }
            });
        },

        startCall: function() {
            if (!familyChat.currentChat.recipient || familyChat.isInCall) return;
            
            familyChat.isCalling = true;
            this.showCallInterface('outgoing');
            
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    this.localStream = stream;
                    this.createPeerConnection();
                    this.addLocalStream();
                    this.createOffer();
                })
                .catch(error => {
                    console.error('Error accessing microphone:', error);
                    this.endCall();
                });
        },

        createPeerConnection: function() {
            const configuration = {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            };
            
            this.peerConnection = new RTCPeerConnection(configuration);
            
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    familyChat.ws.send(JSON.stringify({
                        type: 'webrtc_ice_candidate',
                        candidate: event.candidate,
                        target: familyChat.currentChat.recipient
                    }));
                }
            };
            
            this.peerConnection.ontrack = (event) => {
                const remoteAudio = document.getElementById('fc_remoteAudio');
                if (remoteAudio) {
                    remoteAudio.srcObject = event.streams[0];
                }
            };
        },

        addLocalStream: function() {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
        },

        createOffer: function() {
            this.peerConnection.createOffer()
                .then(offer => {
                    return this.peerConnection.setLocalDescription(offer);
                })
                .then(() => {
                    familyChat.ws.send(JSON.stringify({
                        type: 'webrtc_offer',
                        offer: this.peerConnection.localDescription,
                        target: familyChat.currentChat.recipient
                    }));
                })
                .catch(error => {
                    console.error('Error creating offer:', error);
                    this.endCall();
                });
        },

        handleOffer: function(offer, from) {
            if (this.isInCall || this.isCalling) return;
            
            familyChat.currentChat.recipient = from;
            this.showCallInterface('incoming');
            
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    this.localStream = stream;
                    this.createPeerConnection();
                    this.addLocalStream();
                    return this.peerConnection.setRemoteDescription(offer);
                })
                .then(() => {
                    return this.peerConnection.createAnswer();
                })
                .then(answer => {
                    return this.peerConnection.setLocalDescription(answer);
                })
                .then(() => {
                    familyChat.ws.send(JSON.stringify({
                        type: 'webrtc_answer',
                        answer: this.peerConnection.localDescription,
                        target: from
                    }));
                })
                .catch(error => {
                    console.error('Error handling offer:', error);
                    this.endCall();
                });
        },

        handleAnswer: function(answer) {
            if (!this.isCalling) return;
            
            this.peerConnection.setRemoteDescription(answer)
                .catch(error => {
                    console.error('Error setting remote description:', error);
                    this.endCall();
                });
        },

        handleIceCandidate: function(candidate) {
            if (!this.peerConnection) return;
            
            this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                .catch(error => {
                    console.error('Error adding ICE candidate:', error);
                });
        },

        acceptCall: function() {
            this.isInCall = true;
            this.showCallInterface('active');
            this.playRemoteAudio();
        },

        rejectCall: function() {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_reject',
                target: familyChat.currentChat.recipient
            }));
            this.endCall();
        },

        endCall: function() {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            
            this.hideCallInterface();
            familyChat.isCalling = false;
            familyChat.isInCall = false;
        },

        showCallInterface: function(type) {
            let callHTML = '';
            
            switch(type) {
                case 'outgoing':
                    callHTML = `
                        <div id="fc_callContainer">
                            <div class="call-overlay">
                                <div class="call-dialog">
                                    <h3>Calling ${familyChat.currentChat.recipient}</h3>
                                    <button id="fc_endCall">End Call</button>
                                </div>
                            </div>
                        </div>
                    `;
                    break;
                case 'incoming':
                    callHTML = `
                        <div id="fc_callContainer">
                            <div class="call-overlay">
                                <div class="call-dialog">
                                    <h3>Incoming call from ${familyChat.currentChat.recipient}</h3>
                                    <button id="fc_acceptCall">Accept</button>
                                    <button id="fc_rejectCall">Reject</button>
                                </div>
                            </div>
                        </div>
                    `;
                    break;
                case 'active':
                    callHTML = `
                        <div id="fc_callContainer">
                            <div class="call-overlay">
                                <div class="call-dialog">
                                    <h3>In call with ${familyChat.currentChat.recipient}</h3>
                                    <audio id="fc_remoteAudio" autoplay></audio>
                                    <button id="fc_endCall">End Call</button>
                                </div>
                            </div>
                        </div>
                    `;
                    break;
            }
            
            document.body.insertAdjacentHTML('beforeend', callHTML);
        },

        hideCallInterface: function() {
            const callContainer = document.getElementById('fc_callContainer');
            if (callContainer) {
                callContainer.remove();
            }
        },

        playRemoteAudio: function() {
            const remoteAudio = document.getElementById('fc_remoteAudio');
            if (remoteAudio) {
                remoteAudio.play().catch(error => {
                    console.error('Error playing audio:', error);
                });
            }
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        familyChat.webrtc.init();
    });
})();