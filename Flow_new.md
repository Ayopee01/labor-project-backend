Flow การทำงานของเส้น Worker Application

Auth ใน Role Worker เพื่อเข้าใช้งาน

Get ws workers เพื่อต่อกับ Websocket

หากไม่ต่อจะไม่สามารถใช้ 

POST  /api/workers/me/online

เพื่อทำการเข้าคิวได้ และ Worker จะสามารถเข้าคิวได้แค่ 1 ครั้งของ กะนั้นในวันนั้น หาก

POST  /api/workers/me/offline เพื่อเลิกงานก่อนเวลาก็จะไม่สามารถเข้าได้อีก และหากเวลาของกะสิ้นสุดก็จะให้ Offline ทันทีในกรณีที่ไม่มี Case งานอยู่ หากมี Case งานเมื่อทำการส่งยอดแล้วก็ให้ Offline ได้เลยเพื่อไม่ให้เข้าคิวในการรับงานใหม่อีก

POST  /api/workers/me/break จะสามารถพักได้ 4ครั้งต่อวัน ครั้งละ 15 นาที น่าจะอิงจาก Config ใน db หากว่าคนงานต้องการ Online กลับมาทำงานในขณะที่ break ยังไม่หมด สามารถ POST  /api/workers/me/online เพื่อเข้าคิวได้ตลอดหากมาจาก status break แต่หากมาจาก open app จะมาได้แค่ 1 ครั้งต่อกะในวันนั้น

POST  /api/workers/me/assignments/{vehicleJobRef}/accept มีเวลากดรับงาน 1 นาที น่าจะอิงจาก Config ใน db หากว่าไม่กดรับงานก็จะให้ กลับไปต่อท้ายคิว แต่หากว่าเมื่อถึงคิวแล้วไม่รับงานติดต่อกัน 3 ครั้งต่อเนื่อง ให้นำออกจากคิว โดย POST  /api/workers/me/offline ทันที

POST  /api/workers/me/assignments/{vehicleJobRef}/check-in-qr คนงานหลังจาก Accepted รับงานไปแล้วะจะต้องทำการ Checkin ภายใน 15 นาที จะอิงจาก Config ใน db โดยหาก ว่า คนงานในทีม มีคน Checkin คนแรกแล้ว คนที่เหลือ จะมีเวลา 5 นาทีในการมา Checkin หากมาไม่ทัน จะให้ถูกนำออกจากงาน และให้ไป POST  /api/workers/me/online เพื่อไม่ให้เข้าคิว

POST  /api/workers/me/tickets/{stallJobRef}/complete หลังจากคนงานส่งยอดให้แผงค้าสำเร็จ จะขึ้น status DELIVERED เพื่อรอร้านค้ายืนยันความถูกต้อง หาก LINE ยืนยัน "confirm" POST  /api/line/webhook สถานะที่จะเป็น Complete และนำคนงานกลับเข้าคิว POST  /api/workers/me/online เพื่อทำงานอื่นต่อ แต่หากเป็นการตีกลับยอด "Reject" คนงานจะต้องทำการส่งยอดใหม่อีกครั้งเพื่อให้ สถานะเปลี่ยนเป็น Complete

*** กรณีที่ใน job นี้มีงานมากกว่า 1 ตลาด หรือแผง สามารถไปส่งยอดที่อื่นก่อนได้เลยใน job นี้แต่หากส่งครบแล้วจะต้องรอจนกว่า Vendor Line จะมา confirm ยอดให้ ***

*** ยกเว้น กรณีที่ Admin จะ Force เปลี่ยนสถานะ ready ให้ไปเข้าคิว เพื่อรอเข้าคิวรับงานอื่นได้ ในกรณี Vendor กดยืนยันยอดช้าแล้วมีงานมีเยอะ ส่วนนี้จะให้ Admin จัดการเองเพียงแต่ Admin ต้องสามารถทำได้ เพียงแต่ต่อให้ Force ไป สถานะงาน ก็ยังต้องเป็น รอ Vender มา confirm ด้วย แค่ Status ของคนงานไป ready อย่างเดียว งานที่ทำไปใน case ไม่เกี่ยว***

*** แล้วให้ Vender มีเวลาด้วยหากไม่มากดยืนยันภายในเวลา 24 ชั่วโมง ให้ทำเป็น Config ใน db หากไม่มายืนยันจะให้ status ของงานเป็น complete***

*** แต่หาก Reject กลับมาแล้วคนงานใน Case เก่ารู้ได้ด้วย GET  /api/workers/me/assignments/history 

จะเห็นว่า งานในวันนั้น อันไหนจบหรือไม่จบบ้าง โดยงานไหนที่ไม่ใช่ complete แต่ถูกตีกลับมาเป็น Reject จะสามารถ POST  /api/workers/me/tickets/{stallJobRef}/complete เพื่อทำการส่งยอดอีกครั้งได้***

*** หากส่งยอดไปแล้วหลังจาก กรณีถูกสถานะ Reject กลับมาให้ Vender มีเวลาด้วยหากไม่มากดยืนยันภายในเวลา 4 ชั่วโมง ให้ทำเป็น Config ใน db หากไม่มายืนยันจะให้ status ของงานเป็น complete

วิเคราะห์ กับ Flow ตอนนี้ที ว่าตอนนี้ในส่วน [**Worker Application**](http://localhost:8080/api-docs/#/Worker%20Application) **เป็นแบบนี้ไหม**