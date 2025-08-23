class FamilyChatWebRTC {
    constructor() {
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.currentCallType = null;
        this.currentTarget = null;
        this.isCalling = false;
        
        this.init();
    }
    
    init() {
        // Инициализация обработчиков кнопок
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
        });
    }
    
    setupEventListeners() {
        // Обработчики для кнопок звонков
        document.getElementById('fc_voiceCallButton').addEventListener('click', () => {
            this.initiateCall('audio');
        });
        
        document.getElementById('fc_videoCallButton').addEventListener('click', () => {
            this.initiateCall('video');
        });
        
        document.getElementById('fc_endCallButton').addEventListener('click', () => {
            this.endCall();
        });
        
        document.getElementById('fc_closeVideo').addEventListener('click', () => {
            this.hideVideoElements();
        });
        
        // Обработчики для входящего звонка
        document.getElementById('fc_acceptCall').addEventListener('click', () => {
            this.acceptCall();
        });
        
        document.getElementById('fc_rejectCall').addEventListener('click', () => {
            this.rejectCall();
        });
        
        // Обновляем видимость кнопок при смене чата
        const observer = new MutationObserver(() => {
            this.updateCallButtonsVisibility();
        });
        
        observer.observe(document.getElementById('fc_chatTitle'), {
            childList: true,
            characterData: true,
            subtree: true
        });
    }
    
    updateCallButtonsVisibility() {
        const callButtons = document.getElementById('fc_callButtons');
        const isPrivateChat = familyChat.currentChat.type === 'private' && 
                             familyChat.currentChat.recipient;
        
        if (isPrivateChat) {
            callButtons.style.display = 'block';
            this.currentTarget = familyChat.currentChat.recipient;
        } else {
            callButtons.style.display = 'none';
            this.currentTarget = null;
        }
        
        // Скрываем кнопку завершения если нет активного звонка
        if (!this.isCalling) {
            document.getElementById('fc_endCallButton').style.display = 'none';
        }
    }
    
    async initiateCall(callType) {
        if (!this.currentTarget || !familyChat.ws) return;
        
        try {
            this.currentCallType = callType;
            this.isCalling = true;
            
            // Запрос на звонок
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_call_request',
                target: this.currentTarget,
                callType: callType
            }));
            
            // Показываем кнопку завершения звонка
            document.getElementById('fc_endCallButton').style.display = 'inline-block';
            
            // Инициализируем WebRTC соединение
            await this.setupPeerConnection();
            
            // Получаем медиапоток
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: callType === 'video'
            });
            
            // Добавляем треки в peer connection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Показываем локальное видео если это видеозвонок
            if (callType === 'video') {
                this.showVideoElements();
            }
            
        } catch (error) {
            console.error('Ошибка инициации звонка:', error);
            alert('Не удалось начать звонок: ' + error.message);
            this.endCall();
        }
    }
    
    async setupPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        
        // Обработчик получения удаленного потока
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            const remoteVideo = document.getElementById('fc_remoteVideo');
            remoteVideo.srcObject = this.remoteStream;
        };
        
        // Обработчик ICE кандидатов
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && familyChat.ws) {
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_ice_candidate',
                    target: this.currentTarget,
                    data: event.candidate
                }));
            }
        };
        
        // Обработчик изменения состояния соединения
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                console.log('WebRTC соединение установлено');
            } else if (this.peerConnection.connectionState === 'disconnected' ||
                      this.peerConnection.connectionState === 'failed') {
                this.endCall();
            }
        };
    }
    
    async handleCallRequest(message) {
        this.currentTarget = message.from;
        this.currentCallType = message.callType;
        
        // Показываем уведомление о входящем звонке
        document.getElementById('fc_callerName').textContent = message.from;
        document.getElementById('fc_incomingCall').style.display = 'block';
    }
    
    async acceptCall() {
        try {
            document.getElementById('fc_incomingCall').style.display = 'none';
            this.isCalling = true;
            
            // Уведомляем о принятии звонка
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_call_response',
                target: this.currentTarget,
                accepted: true
            }));
            
            // Инициализируем соединение
            await this.setupPeerConnection();
            
            // Получаем медиапоток
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: this.currentCallType === 'video'
            });
            
            // Добавляем треки в peer connection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Создаем ответ
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            // Отправляем ответ
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_answer',
                target: this.currentTarget,
                data: offer
            }));
            
            // Показываем видео элементы если это видеозвонок
            if (this.currentCallType === 'video') {
                this.showVideoElements();
            }
            
            // Показываем кнопку завершения звонка
            document.getElementById('fc_endCallButton').style.display = 'inline-block';
            
        } catch (error) {
            console.error('Ошибка принятия звонка:', error);
            alert('Не удалось принять звонок: ' + error.message);
            this.endCall();
        }
    }
    
    rejectCall() {
        familyChat.ws.send(JSON.stringify({
            type: 'webrtc_call_response',
            target: this.currentTarget,
            accepted: false
        }));
        
        document.getElementById('fc_incomingCall').style.display = 'none';
        this.resetCallState();
    }
    
    async handleCallResponse(message) {
        if (message.accepted) {
            try {
                // Создаем предложение
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                // Отправляем предложение
                familyChat.ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    target: this.currentTarget,
                    data: offer
                }));
                
            } catch (error) {
                console.error('Ошибка создания предложения:', error);
                this.endCall();
            }
        } else {
            alert('Звонок отклонен');
            this.endCall();
        }
    }
    
    async handleSignal(message) {
        if (!this.peerConnection) return;
        
        try {
            switch (message.type) {
                case 'webrtc_offer':
                    await this.peerConnection.setRemoteDescription(message.data);
                    
                    // Создаем ответ
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    
                    // Отправляем ответ
                    familyChat.ws.send(JSON.stringify({
                        type: 'webrtc_answer',
                        target: message.from,
                        data: answer
                    }));
                    break;
                    
                case 'webrtc_answer':
                    await this.peerConnection.setRemoteDescription(message.data);
                    break;
                    
                case 'webrtc_ice_candidate':
                    await this.peerConnection.addIceCandidate(message.data);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сигнала:', error);
        }
    }
    
    showVideoElements() {
        const localVideo = document.getElementById('fc_localVideo');
        localVideo.srcObject = this.localStream;
        
        document.getElementById('fc_videoContainer').style.display = 'block';
    }
    
    hideVideoElements() {
        document.getElementById('fc_videoContainer').style.display = 'none';
        
        const localVideo = document.getElementById('fc_localVideo');
        const remoteVideo = document.getElementById('fc_remoteVideo');
        
        if (localVideo.srcObject) {
            localVideo.srcObject.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
        
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject = null;
        }
    }
    
    endCall() {
        // Отправляем уведомление о завершении звонка
        if (familyChat.ws && this.currentTarget) {
            familyChat.ws.send(JSON.stringify({
                type: 'webrtc_end_call',
                target: this.currentTarget
            }));
        }
        
        // Закрываем соединение
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Останавливаем медиапотоки
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        this.hideVideoElements();
        document.getElementById('fc_incomingCall').style.display = 'none';
        document.getElementById('fc_endCallButton').style.display = 'none';
        
        this.resetCallState();
    }
    
    resetCallState() {
        this.isCalling = false;
        this.currentCallType = null;
        this.currentTarget = null;
        this.remoteStream = null;
    }
}