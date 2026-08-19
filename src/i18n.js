const EN_REPLACEMENTS = [
  ['Здесь собраны основные условия работы магазина. Выберите нужный раздел:', 'The main store policies are collected here. Choose a section:'],
  ['Бот хранит только данные, необходимые для работы: Telegram ID, имя, историю покупок, пополнений и обращений в поддержку.', 'The bot stores only the information required to operate: Telegram ID, name, purchase and payment history, and support requests.'],
  ['Платёжные данные и пароли от сторонних сервисов бот не запрашивает и не хранит. Коды товаров хранятся в зашифрованном виде. Данные не передаются посторонним, кроме случаев, необходимых для оплаты, работы сервиса или предусмотренных законом.', 'The bot does not request or store card details or passwords for third-party services. Product codes are encrypted. Data is shared only where required for payments, service operation, or by law.'],
  ['Перед оплатой внимательно проверьте название товара, срок подписки, регион активации, цену и описание.', 'Before paying, carefully check the product name, subscription term, activation region, price and description.'],
  ['После подтверждения покупки с баланса списывается указанная сумма, а цифровой код появляется в разделе «Покупки». Код предназначен только для выбранного товара. Передавать его другим людям после получения небезопасно.', 'After confirmation, the stated amount is deducted and the digital code appears under “Purchases”. The code is intended only for the selected product. Do not share it after delivery.'],
  ['Если код не работает, не соответствует описанию или не был выдан, создайте тикет в поддержке и укажите номер покупки.', 'If a code does not work, differs from its description, or was not delivered, create a support ticket and include the purchase number.'],
  ['После проверки мы заменим неисправный код или вернём средства на баланс. Использованный или успешно активированный код вернуть нельзя. Возврат также не выполняется при ошибочном выборе товара или региона, если правильная информация была указана до покупки.', 'After verification, we will replace a defective code or return the funds to your balance. A used or successfully activated code cannot be returned. Refunds are also unavailable for an incorrect product or region selection when accurate information was shown before purchase.'],
  ['Один пользователь может иметь один открытый тикет. Опишите проблему одним сообщением и приложите номер покупки.', 'Each user may have one open ticket. Describe the issue in one message and include the purchase number.'],
  ['Не отправляйте пароли, данные банковской карты и коды подтверждения. Общайтесь спокойно и не создавайте повторные тикеты по одному вопросу. Ответ администратора появится внутри тикета.', 'Never send passwords, card details or confirmation codes. Please communicate respectfully and do not create duplicate tickets. The administrator’s response will appear in the ticket.'],
  ['Создайте тикет — администратор ответит прямо здесь.', 'Create a ticket and an administrator will reply here.'],
  ['У вас есть открытый тикет', 'You have an open ticket'], ['Правила покупки', 'Purchase policy'], ['Правила возврата', 'Refund policy'],
  ['Правила поддержки', 'Support policy'], ['Покупка и выдача', 'Purchase and delivery'], ['Возвраты', 'Refunds'],
  ['Конфиденциальность', 'Privacy'], ['Ко всем правилам', 'All policies'], ['Обратиться в поддержку', 'Contact support'],
  ['Создать или открыть тикет', 'Create or open ticket'], ['Открыть тикет', 'Open ticket'], ['Написать', 'Write'],
  ['Администратор', 'Administrator'], ['Клиент', 'Customer'], ['Система', 'System'], ['Открыт', 'Open'], ['Закрыт', 'Closed'],
  ['Доступны СБП НСПК и LZT Market.', 'SBP NSPK and LZT Market are available.'],
  ['USDT (CryptoBot) и другие криптовалюты через Heleket.', 'USDT via CryptoBot and other cryptocurrencies via Heleket.'],
  ['Почтовые подписки', 'Digital subscriptions'], ['1 месяц', '1 month'], ['3 месяца', '3 months'], ['шт.', 'pcs.'],
  ['Официальный цифровой код подписки. Регион и условия указаны перед оплатой.', 'Official digital subscription code. Region and conditions are shown before payment.'],
  ['Код активации расширенного тарифа для совместимого аккаунта.', 'Activation code for an extended plan on a compatible account.'],
  ['Главное меню', 'Main menu'], ['В главное меню', 'Main menu'], ['Перейти в магазин', 'Open store'],
  ['Каталог', 'Catalog'], ['Личный кабинет', 'Profile'], ['Кабинет', 'Profile'], ['Мои покупки', 'My purchases'], ['Покупки', 'Purchases'],
  ['Пополнение баланса', 'Add funds'], ['Пополнить баланс', 'Add funds'], ['Пополнить', 'Add funds'], ['Поддержка', 'Support'],
  ['Политика конфиденциальности', 'Privacy Policy'], ['Пользовательское соглашение', 'Terms of Service'], ['Правила', 'Policies'],
  ['Админ-панель', 'Admin panel'], ['Выберите раздел, чтобы посмотреть товары:', 'Choose a category to view products:'],
  ['Выберите раздел:', 'Choose a section:'], ['Выберите товар:', 'Choose a product:'], ['Выберите способ оплаты:', 'Choose a payment method:'],
  ['Выберите сумму пополнения:', 'Choose an amount:'], ['В этом разделе пока нет товаров.', 'There are no products in this category yet.'],
  ['Нет в наличии', 'Out of stock'], ['Купить', 'Buy'], ['К товарам', 'Back to products'], ['Все разделы', 'All categories'],
  ['Доступно:', 'Available:'], ['Цена:', 'Price:'], ['Баланс:', 'Balance:'], ['Покупок:', 'Purchases:'],
  ['Покупок пока нет.', 'No purchases yet.'], ['Банковские карты и СБП', 'Bank cards and SBP'], ['Криптовалюта', 'Cryptocurrency'],
  ['Введите свою сумму', 'Enter custom amount'], ['Своя сумма', 'Custom amount'], ['Введите сумму от', 'Enter an amount from'],
  ['одним сообщением.', 'in one message.'], ['Минимальная сумма:', 'Minimum amount:'], ['Доступные способы:', 'Available methods:'],
  ['Комиссия:', 'Fee:'], ['Назад', 'Back'], ['Отмена', 'Cancel'], ['Закрыть', 'Close'], ['Ответить', 'Reply'],
  ['Новый тикет', 'New ticket'], ['Создать тикет', 'Create ticket'], ['Открытые обращения', 'Open tickets'],
  ['Обращений пока нет.', 'No tickets yet.'], ['Сообщений пока нет.', 'No messages yet.'], ['Тикет закрыт', 'Ticket closed'],
  ['Ваш код:', 'Your code:'], ['Покупка выполнена', 'Purchase completed'], ['Недостаточно средств', 'Insufficient funds'],
  ['Товар недоступен', 'Product unavailable'], ['Коды закончились', 'Out of stock'], ['Способ оплаты недоступен', 'Payment method unavailable'],
  ['Проверить оплату', 'Check payment'], ['Проверить ещё раз', 'Check again'], ['Создать новый счёт', 'Create a new invoice'],
  ['Оплатить в CryptoBot', 'Pay in CryptoBot'], ['Оплатить через Heleket', 'Pay with Heleket'], ['Оплатить через LZT Market', 'Pay with LZT Market'],
  ['Счёт CryptoBot создан', 'CryptoBot invoice created'], ['Счёт Heleket создан', 'Heleket invoice created'], ['Счёт LZT Market создан', 'LZT Market invoice created'],
  ['Оплата пока не найдена', 'Payment not found yet'], ['Оплата Heleket пока не подтверждена', 'Heleket payment is not confirmed yet'],
  ['Оплата LZT Market пока не подтверждена', 'LZT Market payment is not confirmed yet'], ['Сумма:', 'Amount:'], ['Статус:', 'Status:'],
  ['После оплаты вернитесь сюда и нажмите «Проверить оплату».', 'After paying, return here and tap “Check payment”.'],
  ['Оплатите счёт и повторите проверку.', 'Pay the invoice and check again.'], ['Криптовалюту и сеть выберите на странице оплаты.', 'Choose the cryptocurrency and network on the payment page.'],
  ['Быстрое меню включено.', 'Quick menu enabled.'], ['Выберите раздел NAREVO', 'Choose a NAREVO section'],
  ['Это меню устарело', 'This menu is outdated'], ['Бот временно остановлен', 'The bot is temporarily unavailable'],
  ['Сейчас проводятся технические работы. Попробуйте позже.', 'Maintenance is in progress. Please try again later.'],
  ['временно остановлен', 'is temporarily unavailable'], ['Спасибо!', 'Thank you!'],
  ['Вы подтвердили ознакомление с документами. Добро пожаловать в NAREVO MAIL!', 'You have accepted the documents. Welcome to NAREVO MAIL!'],
  ['Добро пожаловать в NAREVO MAIL!', 'Welcome to NAREVO MAIL!'], ['Подтверждаю', 'I agree'],
  ['Перед началом использования бота, пожалуйста, ознакомьтесь с документами:', 'Before using the bot, please review these documents:'],
  ['как мы обрабатываем ваши данные', 'how we process your data'], ['условия использования сервиса', 'terms for using the service'],
  ['Нажимайте на кнопки, чтобы прочитать документы.', 'Use the buttons below to read the documents.'],
  ['После ознакомления нажмите', 'After reading them, tap'], ['для доступа в магазин.', 'to access the store.'],
  ['Цифровые коды подписок.', 'Digital subscription codes.'], ['Ошибка:', 'Error:'], ['Введите сумму ещё раз.', 'Enter the amount again.'],
  ['Написать в поддержку', 'Contact support'], ['Заявка на', 'Request for'], ['создана.', 'created.'],
  ['Администратор пришлёт реквизиты и подтвердит оплату.', 'An administrator will send payment details and confirm the payment.'],
  ['Отправьте следующее сообщение — оно попадёт в тикет.', 'Send your next message and it will be added to the ticket.'],
  ['Панель продавца', 'Seller panel'], ['Мои товары', 'My products'], ['Добавить товар', 'Add product'],
  ['Пополнить товар', 'Add stock'], ['Заказы продавца', 'Seller orders'], ['Баланс и вывод', 'Balance and withdrawal'],
  ['Статистика', 'Statistics'], ['Доступно к выводу:', 'Available to withdraw:'], ['В холде 72 часа:', 'Held for 72 hours:'],
  ['В обязательном холде:', 'Mandatory hold:'], ['Холд всегда длится ровно 72 часа и не снимается досрочно.', 'The hold always lasts exactly 72 hours and cannot be released early.'],
  ['Активных товаров:', 'Active products:'], ['Остаток:', 'Stock:'], ['Заказов на проверке:', 'Orders awaiting review:'],
  ['Рейтинг:', 'Rating:'], ['Отзывов:', 'Reviews:'], ['Новый товар', 'New product'], ['Отправьте название товара.', 'Send the product name.'],
  ['Выберите закреплённую категорию:', 'Choose an assigned category:'], ['Товаров пока нет.', 'No products yet.'],
  ['Пополнение товара', 'Add stock'], ['Отправьте товарные единицы: одна строка — одна единица.', 'Send product units, one per line.'],
  ['Подтвердите пополнение', 'Confirm stock addition'], ['Найдено строк:', 'Lines found:'], ['Добавить', 'Add'],
  ['Подтверждение покупки', 'Confirm purchase'], ['Цена за 1 шт.:', 'Unit price:'], ['Итого:', 'Total:'],
  ['После покупки:', 'After purchase:'], ['Подтвердить', 'Confirm'], ['Изменить количество', 'Change quantity'],
  ['Другое количество', 'Custom quantity'], ['Количество товара', 'Product quantity'], ['Количество:', 'Quantity:'],
  ['Проблема с заказом', 'Problem with order'], ['Оставить отзыв', 'Leave a review'], ['Выберите оценку:', 'Choose a rating:'],
  ['Запросить вывод', 'Request withdrawal'], ['Заявки на вывод', 'Withdrawal requests'], ['Балансы пользователей', 'User balances'],
  ['Продавцы', 'Sellers'], ['Заказы продавцов', 'Seller orders'], ['Одобрить', 'Approve'], ['Отклонить', 'Reject'],
  ['Возврат заказа', 'Order refund'], ['Введите причину возврата:', 'Enter the refund reason:'],
  ['Язык', 'Language'], ['Русский', 'Russian'], ['Английский', 'English']
].sort((a,b)=>b[0].length-a[0].length);

export function tr(text, lang='ru') {
  if(lang!=='en'||typeof text!=='string')return text;
  let out=text;
  for(const [ru,en] of EN_REPLACEMENTS)out=out.split(ru).join(en);
  return out;
}

export function localizeMarkup(markup,lang='ru'){
  if(lang!=='en'||!markup)return markup;
  const copy=structuredClone(markup);
  for(const row of copy.inline_keyboard||[])for(const item of row)item.text=tr(item.text,lang);
  for(const row of copy.keyboard||[])for(const item of row)item.text=tr(item.text,lang);
  if(copy.input_field_placeholder)copy.input_field_placeholder=tr(copy.input_field_placeholder,lang);
  return copy;
}

export function languageMenu(){
  return {inline_keyboard:[
    [{text:'🇷🇺 Русский',callback_data:'lang:ru'}],
    [{text:'🇬🇧 English',callback_data:'lang:en'}]
  ]};
}

export const languagePrompt='🌐 <b>Выберите язык / Choose your language</b>\n\nЯзык можно изменить позже в главном меню.\nYou can change it later from the main menu.';
