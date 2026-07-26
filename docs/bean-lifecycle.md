# Bean Lifecycle trong Spring Boot

Bean Lifecycle là quá trình mà một bean được tạo ra, khởi tạo, sử dụng và cuối cùng là bị hủy bỏ trong IoC Container của Spring.

## Các giai đoạn của Bean Lifecycle

### 1. **Instantiation (Tạo bean)**
Spring IoC Container tạo instance của bean (gọi constructor).

### 2. **Populate Properties (Đặt giá trị cho thuộc tính)**
Spring gán các giá trị cho các thuộc tính (qua @Autowired, setter, ...).

### 3. **Aware Interface Callbacks (Gọi các phương thức Aware)**
Nếu bean triển khai các interface Aware, các phương thức tương ứng sẽ được gọi:
- BeanNameAware
- BeanFactoryAware
- ApplicationContextAware
- ...

### 4. **BeanPostProcessor (Trước khi khởi tạo)**
Các BeanPostProcessor có thể can thiệp sau khi bean được khởi tạo (phương thức postProcessBeforeInitialization).

### 5. **Initialization (Khởi tạo bean)**
Gọi phương thức khởi tạo:
- Nếu có @PostConstruct → gọi phương thức được đánh dấu
- Nếu implement InitializingBean → gọi afterPropertiesSet()
- Nếu có hình init-method → gọi phương thức đó

### 6. **BeanPostProcessor (Sau khi khởi tạo)**
Các BeanPostProcessor có thể can thiệp sau khi bean đã được khởi tạo (phương thức postProcessAfterInitialization).

### 7. **Bean is Ready to Use (Bean sẵn sàng sử dụng)**
Bean đã được khởi tạo hoàn tất và sẵn sàng phục vụ trong ứng dụng.

### 8. **Destruction (Hủy bean)**
Khi ApplicationContext đóng, Spring gọi phương thức hủy:
- Nếu có @PreDestroy → gọi phương thức được đánh dấu
- Nếu implement DisposableBean → gọi destroy()
- Nếu có hình destroy-method → gọi phương thức đó

---

## Sơ đồ Sequence minh họa

```
Spring Container          Bean                 BeanPostProcessor
    |                      |                           |
    |--- 1. Tạo instance ---|                           |
    |                      |                           |
    |--- 2. Đặt giá trị thuộc tính ---|                 |
    |                      |                           |
    |--- 3. Gọi các Aware methods ---|                  |
    |                      |                           |
    |--- 4. postProcessBeforeInitialization() ------->  |
    |                      |<------- return -----------|
    |                      |                           |
    |--- 5. Khởi tạo bean ---|                          |
    |   (@PostConstruct / afterPropertiesSet / init) |
    |                      |                           |
    |--- 6. postProcessAfterInitialization() -------->  |
    |                      |<------- return -----------|
    |                      |                           |
    |--- 7. Bean sẵn sàng sử dụng ---|                  |
    |                      |                           |
    | ... Bean đang được sử dụng ...                    |
    |                      |                           |
    |--- 8. Hủy Context ----|                           |
    | (@PreDestroy / destroy / destroy-method)         |
```

---

## Ví dụ code minh họa

```java
@Component
public class MyBean implements InitializingBean, DisposableBean {
    
    public MyBean() {
        System.out.println("1. Constructor");
    }
    
    @Autowired
    private Dependency dependency;
    
    @PostConstruct
    public void initPostConstruct() {
        System.out.println("5. @PostConstruct");
    }
    
    @Override
    public void afterPropertiesSet() {
        System.out.println("5. afterPropertiesSet()");
    }
    
    @PreDestroy
    public void preDestroy() {
        System.out.println("8. @PreDestroy");
    }
    
    @Override
    public void destroy() {
        System.out.println("8. destroy()");
    }
}
```

---

## Thứ tự in ra console

1. Constructor
2. setDependency (nếu có setter)
3. setBeanName (nếu có)
4. postProcessBeforeInitialization
5. @PostConstruct
6. postProcessAfterInitialization
7. Bean sẵn sàng sử dụng
8. @PreDestroy
9. destroy()

---

## Ghi chú

> 💡 Có thể có nhiều BeanPostProcessor tham gia vào quá trình này
