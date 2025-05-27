// 台南飯店優惠監控系統 - LINE Bot 版本
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const express = require('express');
const crypto = require('crypto');

class TainanHotelMonitor {
    constructor(lineChannelAccessToken, lineChannelSecret, userId) {
        this.lineChannelAccessToken = lineChannelAccessToken;
        this.lineChannelSecret = lineChannelSecret;
        this.userId = userId; // 你的 LINE User ID，用於主動推送通知
        this.previousOffers = new Map(); // 儲存之前的優惠資訊
        
        this.hotelSources = [
            {
                name: '台南晶英酒店',
                url: 'https://tainan.silksplace.com/',
                selector: '.promotion, .offer, .news-item, .package'
            },
            {
                name: '煙波大飯店台南館',
                url: 'https://tainan.lakeshore.com.tw/',
                selector: '.promotion, .offer, .special, .package-item'
            },
            {
                name: '台糖長榮酒店',
                url: 'https://tainan.evergreen-hotels.com/',
                selector: '.news-item, .promotion, .package'
            },
            {
                name: '夏都城旅安平館',
                url: 'https://www.chateau.com.tw/anping/',
                selector: '.news, .promotion, .offer'
            },
            {
                name: '和逸飯店台南西門館',
                url: 'https://www.cozzihotels.com/zh-TW/Cozzi-Ximen',
                selector: '.promotion, .offer, .news, .package'
            },
            {
                name: '禧榕軒大飯店',
                url: 'https://www.hrhotel.com.tw/',
                selector: '.news, .promotion, .offer, .package'
            },
            {
                name: '康橋商旅',
                url: 'https://www.kindness-hotel.com.tw/',
                selector: '.news, .promotion, .offer'
            },
            {
                name: '大員皇冠假日酒店',
                url: 'https://www.ihg.com/crowneplaza/hotels/us/en/tainan/tnncr/hoteldetail',
                selector: '.promotion, .offer, .package, .news'
            },
            {
                name: '福爾摩沙遊艇酒店',
                url: 'https://www.formosayacht.com.tw/',
                selector: '.news, .promotion, .offer'
            }
        ];
        
        // 啟動 LINE Bot 功能
        this.setupLineBot();
    }

    // 設定 LINE Bot 伺服器
    setupLineBot() {
        const app = express();
        
        app.use(express.json());
        
        // 健康檢查端點
        app.get('/', (req, res) => {
            res.send('台南飯店監控系統運行中 🏨');
        });
        
        // LINE Bot webhook
        app.post('/webhook', (req, res) => {
            const body = JSON.stringify(req.body);
            const signature = crypto
                .createHmac('SHA256', this.lineChannelSecret)
                .update(body)
                .digest('base64');
            
            if (signature !== req.headers['x-line-signature']) {
                console.log('簽名驗證失敗');
                return res.status(401).send('Unauthorized');
            }
            
            this.handleLineMessage(req.body);
            res.status(200).send('OK');
        });
        
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`LINE Bot server 已啟動在 port ${port}`);
        });
    }

    // 處理 LINE 訊息
    async handleLineMessage(body) {
        const events = body.events;
        
        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const message = event.message.text.trim();
                const replyToken = event.replyToken;
                const userId = event.source.userId;
                
                // 儲存用戶 ID 以便後續推送通知
                this.userId = userId;
                
                await this.processLineCommand(message, replyToken);
            }
        }
    }

    // 處理 LINE 指令
    async processLineCommand(message, replyToken) {
        let replyMessage = '';
        
        if (message.startsWith('移除飯店 ')) {
            const hotelName = message.replace('移除飯店 ', '');
            const removed = this.removeHotel(hotelName);
            replyMessage = removed ? 
                `✅ 已移除「${hotelName}」的監控` : 
                `❌ 找不到「${hotelName}」`;
                
        } else if (message.startsWith('加入飯店 ')) {
            const parts = message.replace('加入飯店 ', '').split(' ');
            if (parts.length >= 2) {
                const hotelName = parts[0];
                const url = parts[1];
                this.addHotel(hotelName, url);
                replyMessage = `✅ 已加入「${hotelName}」的監控\n🔗 ${url}`;
            } else {
                replyMessage = '❌ 格式錯誤！\n正確格式：加入飯店 飯店名稱 官網網址\n\n範例：\n加入飯店 測試飯店 https://test.com';
            }
            
        } else if (message === '查看飯店清單' || message === '飯店清單') {
            replyMessage = this.getHotelList();
            
        } else if (message === '立即檢查' || message === '檢查優惠') {
            replyMessage = '🔍 開始檢查台南飯店優惠，請稍候...';
            await this.replyLineMessage(replyToken, replyMessage);
            this.monitorHotels();
            return;
            
        } else if (message === '幫助' || message === 'help' || message === '指令') {
            replyMessage = `🤖 台南飯店監控機器人

                            📋 基本指令：
                            • 飯店清單 - 查看監控中的飯店
                            • 檢查優惠 - 立即檢查所有飯店
                            • 指令 - 顯示此說明

                            🔧 管理指令：
                            • 加入飯店 [名稱] [網址]
                            • 移除飯店 [名稱]

                            📝 範例：
                            加入飯店 測試飯店 https://test.com
                            移除飯店 測試飯店

                            ⏰ 系統會在每天 8:00 和 14:00 自動檢查優惠`;
        
        } else if (message === '系統狀態' || message === '狀態') {
            replyMessage = `📊 系統狀態報告

                            🏨 監控飯店數量：${this.hotelSources.length} 家
                            📝 優惠記錄數量：${this.previousOffers.size} 筆
                            ⏰ 自動檢查時間：每天 8:00, 14:00
                            🤖 系統運行正常`;
        }
        
        if (replyMessage) {
            await this.replyLineMessage(replyToken, replyMessage);
        }
    }

    // 移除飯店
    removeHotel(hotelName) {
        const index = this.hotelSources.findIndex(hotel => 
            hotel.name.includes(hotelName) || hotelName.includes(hotel.name)
        );
        
        if (index !== -1) {
            this.hotelSources.splice(index, 1);
            return true;
        }
        return false;
    }

    // 加入飯店
    addHotel(hotelName, url) {
        const newHotel = {
            name: hotelName,
            url: url,
            selector: '.promotion, .offer, .news, .package'
        };
        
        // 檢查是否已存在
        const exists = this.hotelSources.some(hotel => hotel.name === hotelName);
        if (!exists) {
            this.hotelSources.push(newHotel);
        }
    }

    // 取得飯店清單
    getHotelList() {
        let list = '🏨 目前監控的飯店清單：\n\n';
        this.hotelSources.forEach((hotel, index) => {
            list += `${index + 1}. ${hotel.name}\n`;
        });
        list += `\n📊 總共監控 ${this.hotelSources.length} 家飯店`;
        return list;
    }

    // 回覆 LINE 訊息
    async replyLineMessage(replyToken, message) {
        try {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [{
                    type: 'text',
                    text: message
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.lineChannelAccessToken}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.error('LINE 回覆失敗:', error.message);
        }
    }

    // 主動推送訊息給用戶
    async pushLineMessage(message) {
        if (!this.userId) {
            console.log('沒有用戶 ID，無法推送訊息');
            return;
        }

        try {
            await axios.post('https://api.line.me/v2/bot/message/push', {
                to: this.userId,
                messages: [{
                    type: 'text',
                    text: message
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${this.lineChannelAccessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('LINE 推送訊息成功');
        } catch (error) {
            console.error('LINE 推送訊息失敗:', error.message);
        }
    }

    // 爬取單個網站的優惠資訊
    async scrapeHotelOffers(source) {
        try {
            console.log(`正在檢查 ${source.name}...`);
            
            const response = await axios.get(source.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });
            
            const $ = cheerio.load(response.data);
            const offers = [];
            
            $(source.selector).each((index, element) => {
                const $elem = $(element);
                const title = $elem.find('h1, h2, h3, .title, .name').first().text().trim();
                const price = $elem.find('.price, .rate, .cost, .amount').first().text().trim();
                const description = $elem.find('.description, .detail, p').first().text().trim();
                
                if (title && (price || description)) {
                    offers.push({
                        hotel: source.name,
                        title: title.substring(0, 100),
                        price: price.substring(0, 50),
                        description: description.substring(0, 200),
                        url: source.url,
                        timestamp: new Date().toISOString()
                    });
                }
            });
            
            return offers;
        } catch (error) {
            console.error(`爬取 ${source.name} 時發生錯誤:`, error.message);
            return [];
        }
    }

    // 檢查是否為新優惠
    isNewOffer(offer) {
        const key = `${offer.hotel}-${offer.title}`;
        const previousOffer = this.previousOffers.get(key);
        
        if (!previousOffer) {
            return true; // 完全新的優惠
        }
        
        // 檢查價格是否有變化
        if (offer.price !== previousOffer.price) {
            return true;
        }
        
        return false;
    }

    // 發送優惠通知
    async sendOfferNotification(offers) {
        if (offers.length === 0) return;
        
        let message = '🏨 發現台南飯店新優惠！\n\n';
        
        offers.slice(0, 5).forEach((offer, index) => { // 限制最多5個優惠避免訊息太長
            message += `${index + 1}. ${offer.hotel}\n`;
            message += `📝 ${offer.title}\n`;
            if (offer.price) {
                message += `💰 ${offer.price}\n`;
            }
            if (offer.description) {
                message += `📋 ${offer.description.substring(0, 60)}...\n`;
            }
            message += `🔗 ${offer.url}\n\n`;
        });
        
        if (offers.length > 5) {
            message += `... 還有 ${offers.length - 5} 個優惠\n`;
        }
        
        message += `⏰ 檢查時間：${new Date().toLocaleString('zh-TW')}`;
        
        await this.pushLineMessage(message);
    }

    // 主要監控函數
    async monitorHotels() {
        console.log('開始監控台南飯店優惠...', new Date().toLocaleString());
        
        const newOffers = [];
        let checkedCount = 0;
        
        for (const source of this.hotelSources) {
            const offers = await this.scrapeHotelOffers(source);
            checkedCount++;
            
            for (const offer of offers) {
                if (this.isNewOffer(offer)) {
                    newOffers.push(offer);
                    // 更新儲存的優惠資訊
                    const key = `${offer.hotel}-${offer.title}`;
                    this.previousOffers.set(key, offer);
                }
            }
            
            // 避免過於頻繁的請求
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        console.log(`檢查完成！共檢查 ${checkedCount} 家飯店`);
        
        if (newOffers.length > 0) {
            console.log(`發現 ${newOffers.length} 個新優惠`);
            await this.sendOfferNotification(newOffers);
        } else {
            console.log('沒有發現新的優惠');
            // 可選：發送無新優惠的通知
            // await this.pushLineMessage(`✅ 已檢查完 ${checkedCount} 家飯店，目前沒有新優惠`);
        }
    }

    // 啟動定時監控
    startMonitoring() {
        console.log('🚀 台南飯店優惠監控系統已啟動');
        
        // 每天早上 8:00 執行
        cron.schedule('0 8 * * *', () => {
            console.log('⏰ 定時檢查開始...');
            this.monitorHotels();
        });
        
        // 每天下午 2:00 再檢查一次
        cron.schedule('0 14 * * *', () => {
            console.log('⏰ 下午檢查開始...');
            this.monitorHotels();
        });
        
        console.log('⏰ 定時任務已設定：每天 8:00 和 14:00 自動檢查');
        
        // 啟動後 10 秒執行一次測試
        setTimeout(() => {
            console.log('🔍 執行初始檢查...');
            this.monitorHotels();
        }, 10000);
    }
}

// 使用方式
const monitor = new TainanHotelMonitor(
    process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
    process.env.LINE_CHANNEL_SECRET || 'YOUR_LINE_CHANNEL_SECRET',
    process.env.LINE_USER_ID || null // 可選，系統會自動記錄第一個與 Bot 互動的用戶
);

// 啟動監控系統
monitor.startMonitoring();

// 匯出模組
module.exports = TainanHotelMonitor;